#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import {
	type ComputerInterface,
	type DragOptions,
	MacOSHostComputer,
	clickPoint,
	getAppStateForApp,
	parseElementIndex,
	parseKeyChord,
	pressElement,
	resolveAppPid,
	scrollElement,
	withTargetedApp,
} from "@macos-cua/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

type ToolContent =
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType: "image/png" | "image/jpeg" };

type ToolResult = {
	content: ToolContent[];
};

const SERVER_INFO = {
	name: "macos-cua",
	version: "0.1.0",
} as const;

export const TOOL_NAMES = [
	"list_apps",
	"get_app_state",
	"click",
	"perform_secondary_action",
	"set_value",
	"drag",
	"scroll",
	"type_text",
	"press_key",
] as const;

const appSchema = z.string().min(1);

const getAppStateSchema = z.object({
	app: appSchema,
});

const clickSchema = z.object({
	app: appSchema,
	element_index: z.string().optional(),
	x: z.number().optional(),
	y: z.number().optional(),
	click_count: z.number().int().positive().optional(),
	mouse_button: z.enum(["left", "right", "middle"]).optional(),
});

const performSecondaryActionSchema = z.object({
	app: appSchema,
	element_index: z.string(),
	action: z.string().min(1),
});

const setValueSchema = z.object({
	app: appSchema,
	element_index: z.string(),
	value: z.string(),
});

const dragSchema = z.object({
	app: appSchema,
	from_x: z.number(),
	from_y: z.number(),
	to_x: z.number(),
	to_y: z.number(),
});

const scrollSchema = z.object({
	app: appSchema,
	direction: z.enum(["up", "down", "left", "right"]),
	element_index: z.string().optional(),
	pages: z.number().positive().optional(),
});

const typeTextSchema = z.object({
	app: appSchema,
	text: z.string(),
});

const pressKeySchema = z.object({
	app: appSchema,
	key: z.string().min(1),
});

const emptySchema = z.object({});

function textResult(text: string): ToolResult {
	return { content: [{ type: "text", text }] };
}

function actionComplete(): ToolResult {
	return textResult("Action completed. Call `get_app_state` to fetch the updated UI state.");
}

export function createMcpServer(computer: ComputerInterface = new MacOSHostComputer()): McpServer {
	const server = new McpServer(SERVER_INFO);

	server.registerTool(
		"list_apps",
		{
			description:
				"List the apps on this computer. Returns the set of apps that are currently running, including details on usage frequency where available.",
			inputSchema: emptySchema,
		},
		async (): Promise<ToolResult> => {
			return textResult(JSON.stringify(await computer.listApps(), null, 2));
		},
	);

	server.registerTool(
		"get_app_state",
		{
			description:
				"Start an app use session if needed, then get the state of the app's key window and return a screenshot and accessibility tree.",
			inputSchema: getAppStateSchema,
		},
		async ({ app }): Promise<ToolResult> => {
			const state = await getAppStateForApp(computer, app);
			return {
				content: [
					{ type: "image", data: state.screenshotBase64, mimeType: "image/png" },
					{ type: "text", text: JSON.stringify({ ...state, screenshotBase64: undefined }, null, 2) },
				],
			};
		},
	);

	server.registerTool(
		"click",
		{
			description: "Click an element by index or pixel coordinates from screenshot.",
			inputSchema: clickSchema,
		},
		async ({ app, element_index, x, y, click_count, mouse_button }): Promise<ToolResult> => {
			const targetPid = await resolveAppPid(computer, app);
			const pressCount = Math.max(1, Math.trunc(click_count ?? 1));
			if (element_index !== undefined) {
				const index = parseElementIndex(element_index);
				for (let pressIndex = 0; pressIndex < pressCount; pressIndex += 1) {
					await pressElement(computer, targetPid, index);
				}
				void mouse_button;
				return actionComplete();
			}
			const point = parseCoordinate(x, y);
			if ((mouse_button ?? "left") === "left") {
				let pressedAll = true;
				for (let pressIndex = 0; pressIndex < pressCount; pressIndex += 1) {
					if (!(await computer.pressAtPosition(targetPid, point))) {
						pressedAll = false;
						break;
					}
				}
				if (pressedAll) {
					return actionComplete();
				}
			}
			await withTargetedApp(computer, targetPid, async () => {
				await clickPoint(computer, point, mouse_button ?? "left", pressCount);
			});
			return actionComplete();
		},
	);

	server.registerTool(
		"perform_secondary_action",
		{
			description: "Invoke a secondary accessibility action exposed by an element.",
			inputSchema: performSecondaryActionSchema,
		},
		async ({ app, element_index, action }): Promise<ToolResult> => {
			await computer.performAction(await resolveAppPid(computer, app), parseElementIndex(element_index), action);
			return actionComplete();
		},
	);

	server.registerTool(
		"set_value",
		{
			description: "Set the value of a settable accessibility element.",
			inputSchema: setValueSchema,
		},
		async ({ app, element_index, value }): Promise<ToolResult> => {
			await computer.setValue(await resolveAppPid(computer, app), parseElementIndex(element_index), value);
			return actionComplete();
		},
	);

	server.registerTool(
		"drag",
		{
			description: "Drag from one point to another using pixel coordinates.",
			inputSchema: dragSchema,
		},
		async ({ app, from_x, from_y, to_x, to_y }): Promise<ToolResult> => {
			const targetPid = await resolveAppPid(computer, app);
			const dragOptions: DragOptions = { from: { x: from_x, y: from_y }, to: { x: to_x, y: to_y } };
			await withTargetedApp(computer, targetPid, async () => {
				await computer.drag(dragOptions);
			});
			return actionComplete();
		},
	);

	server.registerTool(
		"scroll",
		{
			description: "Scroll an element in a direction by a number of pages.",
			inputSchema: scrollSchema,
		},
		async ({ app, direction, element_index, pages }): Promise<ToolResult> => {
			if (element_index === undefined) {
				throw new Error("scroll requires element_index of a scrollable accessibility element");
			}
			const targetPid = await resolveAppPid(computer, app);
			await scrollElement(computer, targetPid, parseElementIndex(element_index), direction, pages ?? 1);
			return actionComplete();
		},
	);

	server.registerTool(
		"type_text",
		{
			description: "Type literal text using keyboard input.",
			inputSchema: typeTextSchema,
		},
		async ({ app, text }): Promise<ToolResult> => {
			const targetPid = await resolveAppPid(computer, app);
			if (await computer.typeIntoFocused(targetPid, text)) {
				return actionComplete();
			}
			await withTargetedApp(computer, targetPid, async () => {
				await computer.type(text);
			});
			return actionComplete();
		},
	);

	server.registerTool(
		"press_key",
		{
			description: "Press a key or key-combination on the keyboard, including modifier and navigation keys.",
			inputSchema: pressKeySchema,
		},
		async ({ app, key }): Promise<ToolResult> => {
			const targetPid = await resolveAppPid(computer, app);
			const keypress = parseKeyChord(key);
			await withTargetedApp(computer, targetPid, async () => {
				await computer.key(
					keypress.key,
					keypress.modifiers.length === 0 ? undefined : { modifiers: [...keypress.modifiers] },
				);
			});
			return actionComplete();
		},
	);

	return server;
}

function parseCoordinate(x: number | undefined, y: number | undefined): { x: number; y: number } {
	if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
		throw new Error("click requires either element_index or finite x and y coordinates");
	}
	return { x, y };
}

export async function main(): Promise<void> {
	const server = createMcpServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch((error: unknown) => {
		const details = error instanceof Error ? (error.stack ?? error.message) : String(error);
		process.stderr.write(`Fatal error: ${details}\n`);
		process.exit(1);
	});
}

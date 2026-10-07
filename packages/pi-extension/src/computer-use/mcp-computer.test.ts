import { afterEach, describe, expect, it } from "vitest";

import { type FakeAppleCuaServer, guardedWindowServer, textAnswer } from "../../test/support/fake-apple-cua.js";
import { McpBridge } from "../mcp-bridge.js";
import { McpComputer, ObservedTarget, UNOBSERVED_DISPLAY } from "./mcp-computer.js";

interface Rig {
	readonly fake: FakeAppleCuaServer;
	readonly bridge: McpBridge;
	readonly target: ObservedTarget;
	readonly computer: McpComputer;
	readonly waits: number[];
}

const rigs: Rig[] = [];

async function rig(fake: FakeAppleCuaServer = guardedWindowServer()): Promise<Rig> {
	const target = new ObservedTarget();
	const bridge = new McpBridge(fake.connect);
	bridge.onToolResult((_name, args, result) => target.record(args, result));
	bridge.onServerExit(() => target.forgetToken());
	await bridge.start();
	const waits: number[] = [];
	const computer = new McpComputer(
		(name, args) => bridge.callTool(name, args),
		target,
		async (milliseconds) => {
			waits.push(milliseconds);
		},
	);
	const created = { fake, bridge, target, computer, waits };
	rigs.push(created);
	return created;
}

afterEach(async () => {
	for (const created of rigs.splice(0)) {
		await created.bridge.close();
	}
});

const LEFT_CLICK = { button: "left", count: 1, modifiers: [] } as const;

describe("#given no app has been observed #when a native action runs #then it asks for an observation and sends nothing", () => {
	it.each([
		["screenshot", (computer: McpComputer) => computer.screenshot()],
		["click", (computer: McpComputer) => computer.click({ x: 1, y: 1 }, LEFT_CLICK)],
		["type", (computer: McpComputer) => computer.typeText("hi")],
	])("refuses %s", async (_action, run) => {
		const { fake, computer } = await rig();

		await expect(run(computer)).rejects.toMatchObject({ kind: "needs_observation" });
		expect(fake.calls).toEqual([]);
		expect(computer.display()).toEqual(UNOBSERVED_DISPLAY);
	});
});

describe("#given the model observed an app with get_app_state #when computer acts #then the observation's token and pixels are used", () => {
	it("declares the window screenshot as the display and clicks in its pixels with the newest token", async () => {
		const { fake, bridge, computer } = await rig();
		await bridge.callTool("get_app_state", { app: "Notes" });

		const result = await computer.click({ x: 800.4, y: 500.6 }, LEFT_CLICK);

		expect(computer.display()).toEqual({
			logicalWidth: 1600,
			logicalHeight: 1000,
			modelWidth: 1600,
			modelHeight: 1000,
		});
		expect(fake.callsTo("click")).toEqual([
			{ name: "click", args: { app: "Notes", observation_token: "token-1", x: 800, y: 501 } },
		]);
		expect(result.content).toEqual([
			{
				type: "text",
				text: JSON.stringify({ actionDispatched: true, effect: "observed_change", observation_token: "token-2" }),
			},
		]);
	});

	it("chains each action on the token the previous answer issued", async () => {
		const { fake, bridge, computer } = await rig();
		await bridge.callTool("get_app_state", { app: "Notes" });

		await computer.click({ x: 10, y: 20 }, { button: "right", count: 1, modifiers: [] });
		await computer.click({ x: 10, y: 20 }, { button: "left", count: 3, modifiers: ["command"] });
		await computer.drag({ x: 1, y: 2 }, { x: 30, y: 40 });
		await computer.typeText("안녕하세요");
		await computer.pressKeys(["cmd+shift+t", { key: "shift", hold_seconds: 1.5 }]);

		expect(fake.calls.slice(1)).toEqual([
			{ name: "click", args: { app: "Notes", observation_token: "token-1", x: 10, y: 20, mouse_button: "right" } },
			{
				name: "click",
				args: { app: "Notes", observation_token: "token-2", x: 10, y: 20, click_count: 3, modifiers: ["command"] },
			},
			{
				name: "drag",
				args: { app: "Notes", observation_token: "token-3", from_x: 1, from_y: 2, to_x: 30, to_y: 40 },
			},
			{ name: "type_text", args: { app: "Notes", observation_token: "token-4", text: "안녕하세요" } },
			{
				name: "press_keys",
				args: {
					app: "Notes",
					observation_token: "token-5",
					keys: ["cmd+shift+t", { key: "shift", hold_seconds: 1.5 }],
				},
			},
		]);
	});
});

describe("#given a native screenshot #when it runs #then it re-observes the target window and returns its image", () => {
	it("calls get_app_state for the target and keeps the image with a compact summary instead of the tree", async () => {
		const { fake, bridge, computer } = await rig();
		await bridge.callTool("get_app_state", { app: "Notes" });

		const result = await computer.screenshot();
		await computer.click({ x: 5, y: 5 }, LEFT_CLICK);

		expect(fake.calls[1]).toEqual({ name: "get_app_state", args: { app: "Notes", element_format: "table" } });
		expect(result.content).toEqual([
			{ type: "image", data: "d2luZG93", mimeType: "image/jpeg" },
			{
				type: "text",
				text: JSON.stringify({
					app: "Notes",
					bundleId: "com.example.Notes",
					windowTitle: "Draft",
					screenshotWidth: 1600,
					screenshotHeight: 1000,
				}),
			},
		]);
		expect(fake.callsTo("click")[0]?.args["observation_token"]).toBe("token-2");
	});

	it("fails when the server sends no image, passing on its note", async () => {
		const fake = guardedWindowServer().handle("get_app_state", () =>
			textAnswer({
				app: "Notes",
				observation_token: "t1",
				screenshotNote: "no image: Screen Recording is not granted",
			}),
		);
		const { bridge, computer } = await rig(fake);
		await bridge.callTool("get_app_state", { app: "Notes" });

		await expect(computer.screenshot()).rejects.toThrow(/no image of Notes.*Screen Recording is not granted/);
	});
});

describe("#given an answer without a token #when the next action runs #then it needs a fresh screenshot", () => {
	it("withdraws the authority after a paused answer and restores it with a screenshot", async () => {
		const fake = guardedWindowServer().handle("type_text", () =>
			textAnswer({ actionDispatched: true, observationStatus: "context-changed", paused: true }),
		);
		const { bridge, computer } = await rig(fake);
		await bridge.callTool("get_app_state", { app: "Notes" });
		await computer.typeText("a");

		await expect(computer.pressKeys(["return"])).rejects.toMatchObject({ kind: "needs_observation" });
		await computer.screenshot();
		await computer.pressKeys(["return"]);

		expect(fake.callsTo("press_keys")).toHaveLength(1);
	});

	it("withdraws the authority after a refusal and surfaces the server's reason", async () => {
		const { bridge, target, computer } = await rig();
		await bridge.callTool("get_app_state", { app: "Notes" });
		await bridge.callTool("click", { app: "Notes", observation_token: "token-1", x: 1, y: 1 });

		await expect(
			bridge.callTool("click", { app: "Notes", observation_token: "token-1", x: 1, y: 1 }),
		).resolves.toMatchObject({
			isError: true,
		});
		expect(target.current()?.token).toBeUndefined();
		await expect(computer.typeText("x")).rejects.toMatchObject({ kind: "needs_observation" });
	});

	it("forgets the token when the server restarts, since the new server never issued it", async () => {
		const { fake, bridge, computer } = await rig();
		await bridge.callTool("get_app_state", { app: "Notes" });

		await fake.exit();

		await expect(computer.click({ x: 1, y: 1 }, LEFT_CLICK)).rejects.toMatchObject({ kind: "needs_observation" });
		await computer.screenshot();
		expect(fake.connections).toBe(2);
	});
});

describe("#given answers about several apps #when they arrive #then the newest observed app becomes the target", () => {
	it("follows a token for another app and ignores another app's refusal", async () => {
		const target = new ObservedTarget();
		target.record(
			{ app: "Notes" },
			textAnswer({ observation_token: "n1", screenshotWidth: 800, screenshotHeight: 600 }),
		);
		target.record({ app: "Safari" }, textAnswer({ observation_token: "s1" }));
		target.record({ app: "Notes" }, { isError: true, content: [{ type: "text", text: "refused" }] });

		expect(target.current()).toEqual({ app: "Safari", token: "s1", display: undefined });
	});
});

describe("#given a wait #when it runs #then the delay is local and nothing is sent", () => {
	it("waits the requested time", async () => {
		const { fake, computer, waits } = await rig();

		await computer.wait(250);

		expect(waits).toEqual([250]);
		expect(fake.calls).toEqual([]);
	});
});

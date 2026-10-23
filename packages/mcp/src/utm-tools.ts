import { randomUUID } from "node:crypto";
import type { Point, ScreenshotResult, StopStatusSource, UTMObservation } from "@apple-cua/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { allowedBundleIdsFromProcessEnvironment } from "./native-policy.js";
import { type ToolResult, textResult } from "./tool-result.js";
import { UtmRefusal, stepSchema, textTargets, visualAction } from "./utm-visual-actions.js";

interface UtmVm {
	readonly id: string;
	readonly name: string;
	readonly status: string;
	readonly backend: string;
}

export interface UtmToolSource {
	list(): Promise<readonly UtmVm[]>;
	screenshot(vm: string): Promise<ScreenshotResult>;
	observe(vm: string): Promise<UTMObservation>;
	move(vm: string, point: Point): Promise<void>;
	clickObserved(vm: string, point: Point, observation: UTMObservation): Promise<void>;
	click(
		vm: string,
		point: { x: number; y: number },
		options?: { button?: "left" | "right" | "middle"; monitor?: number },
	): Promise<void>;
	type(vm: string, text: string): Promise<void>;
	key(vm: string, combo: string): Promise<void>;
}

interface UtmToolOptions {
	readonly stopSwitch?: StopStatusSource;
	readonly now?: () => number;
	readonly ttlMs?: number;
}

/** Tokens bind observed context, not human consent. */
export function registerUtmTools(server: McpServer, source: UtmToolSource, options: UtmToolOptions = {}): void {
	const tokens = new Map<string, { token: string; vm: UtmVm; issuedAt: number; observation: UTMObservation }>();
	const now = options.now ?? Date.now;
	let tail: Promise<void> = Promise.resolve();

	function checkGate(): void {
		const allowed = allowedBundleIdsFromProcessEnvironment();
		if (allowed !== undefined && !allowed.includes("com.utmapp.UTM")) {
			tokens.clear();
			throw new UtmRefusal("app-not-allowed", "UTM is excluded by APPLE_CUA_ALLOWED_BUNDLE_IDS.");
		}
		if (options.stopSwitch?.status().stopped === true) {
			tokens.clear();
			throw new UtmRefusal("user-stopped", "The stop switch is active.");
		}
	}

	async function resolve(vm: string): Promise<UtmVm> {
		checkGate();
		const machines = await source.list();
		checkGate();
		const machine = machines.find((entry) => entry.id === vm);
		if (machine === undefined) throw new UtmRefusal("utm-vm-not-found", "Select an exact VM UUID from utm_list.");
		return machine;
	}

	async function observe(vm: string, expected?: UtmVm, completed = 0): Promise<ToolResult> {
		tokens.delete(vm);
		const machine = await resolve(vm);
		if (expected !== undefined && (machine.status !== expected.status || machine.backend !== expected.backend)) {
			throw new UtmRefusal("utm-context-changed", "VM status or backend changed; observe again.");
		}
		const observation = await source.observe(machine.id);
		const { image } = observation;
		checkGate();
		// Recheck context after capture so asynchronous status changes cannot mint stale authority.
		const current = await resolve(machine.id);
		if (current.status !== machine.status || current.backend !== machine.backend) {
			throw new UtmRefusal("utm-context-changed", "VM status or backend changed during capture; observe again.");
		}
		const token = randomUUID();
		tokens.set(machine.id, { token, vm: current, issuedAt: now(), observation });
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify({
						vm: current,
						width: image.width,
						height: image.height,
						screenshot_space: "host-window-including-chrome",
						input_space: "guest-display-pixels",
						displayRect: observation.displayRect,
						guestSize: observation.guestSize,
						windowId: observation.windowId,
						cursor: observation.cursor,
						texts: textTargets(observation, token),
						observation_token: token,
						...(completed === 0
							? {}
							: { stepsCompleted: completed, actionDispatched: true, effect: "unverifiable" }),
					}),
				},
				{ type: "image", data: image.data.toString("base64"), mimeType: image.mimeType },
			],
		};
	}

	function serial(operation: () => Promise<ToolResult>): Promise<ToolResult> {
		const result = tail.then(operation);
		tail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	async function guarded(operation: () => Promise<ToolResult>, progress?: () => number): Promise<ToolResult> {
		try {
			checkGate();
			return await operation();
		} catch (error) {
			return {
				isError: true,
				content: [
					{
						type: "text",
						text: JSON.stringify({
							reason: error instanceof UtmRefusal ? error.reason : "utm-failed",
							message: error instanceof Error ? error.message : String(error),
							...(progress === undefined
								? {}
								: { stepsCompleted: progress(), actionDispatched: progress() > 0, effect: "unverifiable" }),
						}),
					},
				],
			};
		}
	}

	server.registerTool(
		"utm_list",
		{
			description: "List UTM VM UUIDs, names, status and backend. Inventory authorizes no input.",
			inputSchema: {},
			annotations: { readOnlyHint: true, destructiveHint: false },
		},
		async () =>
			serial(() =>
				guarded(async () => {
					const machines = await source.list();
					checkGate();
					return textResult(JSON.stringify({ vms: machines }));
				}),
			),
	);
	server.registerTool(
		"utm_observe",
		{
			description:
				"Observe an exact VM UUID with screenshot, guest-pixel OCR targets, displayRect in screenshot pixels, guestSize and cursor. Requires a Windows QEMU guest agent. Issues a one-use context token, not human consent.",
			inputSchema: { vm: z.uuid() },
			annotations: { readOnlyHint: true, destructiveHint: false },
		},
		async ({ vm }) => serial(() => guarded(async () => observe(vm))),
	);
	server.registerTool(
		"utm_run",
		{
			description:
				"Run 1-8 QEMU steps with a one-use observation_token: type, key, click/move (coordinate_space=guest-display-pixels), click-image (screenshot x/y mapped through chrome/letterboxing), click-text (unique case-insensitive text or element_id), observe (refresh). Visual references after any input require observe first. Observation/move require a Windows QEMU guest agent. Returns fresh context, not proof of effect or human consent.",
			inputSchema: {
				vm: z.uuid(),
				observation_token: z.string().min(1),
				steps: z.array(stepSchema).min(1).max(8),
			},
			annotations: { readOnlyHint: false, destructiveHint: true },
		},
		async ({ vm, observation_token, steps }) =>
			serial(async () => {
				let completed = 0;
				return guarded(
					async () => {
						const authority = tokens.get(vm);
						if (authority === undefined || authority.token !== observation_token) {
							throw new UtmRefusal("utm-token-invalid", "Token is stale, consumed, or belongs to another VM.");
						}
						tokens.delete(vm);
						if (now() - authority.issuedAt > (options.ttlMs ?? 120_000)) {
							throw new UtmRefusal("utm-token-expired", "Observe again before input.");
						}
						let observation = authority.observation;
						let referenceToken = authority.token;
						let dirty = false;
						const expected = authority.vm;
						async function checkContext(): Promise<void> {
							const current = await resolve(vm);
							if (current.status !== expected.status || current.backend !== expected.backend) {
								throw new UtmRefusal("utm-context-changed", "VM status or backend changed; observe again.");
							}
							if (current.backend.toLowerCase() !== "qemu" || current.status.toLowerCase() !== "started") {
								throw new UtmRefusal("utm-input-unavailable", "Native input requires a started QEMU VM.");
							}
							checkGate();
						}
						for (const step of steps) {
							await checkContext();
							switch (step.action) {
								case "observe":
									observation = await source.observe(vm);
									await checkContext();
									referenceToken = randomUUID();
									dirty = false;
									continue;
								case "move":
									await source.move(vm, { x: step.x, y: step.y });
									break;
								case "click-image":
								case "click-text":
									if (dirty) {
										throw new UtmRefusal(
											"utm-visual-reference-stale",
											"Refresh with observe before visual input.",
										);
									}
									await visualAction(source, vm, step, observation, referenceToken, checkContext);
									break;
								case "type":
									await source.type(vm, step.text);
									break;
								case "key":
									await source.key(vm, step.combo);
									break;
								case "click":
									await source.click(
										vm,
										{ x: step.x, y: step.y },
										{
											...(step.button === undefined ? {} : { button: step.button }),
											...(step.monitor === undefined ? {} : { monitor: step.monitor }),
										},
									);
									break;
							}
							dirty = true;
							completed++;
						}
						return observe(vm, authority.vm, completed);
					},
					() => completed,
				);
			}),
	);
}

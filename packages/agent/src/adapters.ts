import type { ComputerInterface } from "@apple-cua/core";
import type { AppState } from "@apple-cua/core";
import type { MirroringObservation } from "@apple-cua/core";
import { buildMacActionSpace } from "./action-space.js";
import type { ActionSpaceOptions } from "./action-space.js";
import type { ExecutionResult, Observation, PlatformAdapter } from "./adapter.js";
import { buildPhoneActionSpace } from "./phone-space.js";
import type { Decision } from "./types.js";

const DEFAULT_SCROLL_AMOUNT = 400;
const DEFAULT_WAIT_MILLISECONDS = 400;
const DEFAULT_MAX_ELEMENTS = 600;

export interface MacAdapterOptions {
	readonly computer: ComputerInterface;
	readonly app: string;
	readonly maxElements?: number;
	readonly windowId?: number;
	readonly space?: ActionSpaceOptions;
	readonly scrollAmount?: number;
	readonly waitMilliseconds?: number;
}

export function macosAdapter(options: MacAdapterOptions): PlatformAdapter<AppState> {
	let pid: number | undefined;
	return {
		platform: "macos",
		async observe(): Promise<Observation<AppState>> {
			const resolved = pid ?? (await resolvePid(options.computer, options.app));
			pid = resolved;
			const state = await options.computer.getAppState(resolved, {
				includeScreenshot: false,
				maxElements: options.maxElements ?? DEFAULT_MAX_ELEMENTS,
				...(options.windowId === undefined ? {} : { windowId: options.windowId }),
			});
			return { space: buildMacActionSpace(state, options.space ?? {}), state };
		},
		async execute(observation: Observation<AppState>, decision: Decision): Promise<ExecutionResult> {
			const observationKey = observation.state.observationKey ?? "";
			if (decision.target !== undefined && !isCurrent(options.computer, observationKey, observation.state.pid)) {
				return {
					status: "refused",
					route: "none",
					detail: "stale-observation: element ids no longer belong to this observation",
				};
			}
			try {
				return await dispatchMac(options, observation.state.pid, decision);
			} catch (error) {
				return { status: "failed", route: "none", detail: messageOf(error) };
			}
		},
	};
}

/**
 * The guard that makes an element id safe to use. The driver invalidates the key on every newer
 * walk, so a stale id can never name a different control — no re-read of the element is needed.
 */
function isCurrent(computer: ComputerInterface, observationKey: string, pid: number): boolean {
	try {
		computer.assertObservationCurrent(pid, observationKey);
		return true;
	} catch {
		return false;
	}
}

async function dispatchMac(options: MacAdapterOptions, pid: number, decision: Decision): Promise<ExecutionResult> {
	const { computer } = options;
	switch (decision.operation) {
		case "PRESS": {
			const target = requireTarget(decision);
			await computer.performAction(pid, target.index, "AXPress");
			return { status: "ran", route: "accessibility", detail: `pressed ${target.label}` };
		}
		case "TYPE_TEXT": {
			const target = requireTarget(decision);
			if (decision.text === undefined || decision.text === "") {
				return { status: "refused", route: "none", detail: "TYPE_TEXT ran without a value to write" };
			}
			await computer.setValue(pid, target.index, decision.text);
			return {
				status: "ran",
				route: "accessibility",
				detail: `wrote ${decision.text.length} characters into ${target.label}`,
			};
		}
		case "SCROLL_UP":
		case "SCROLL_DOWN": {
			const direction = decision.operation === "SCROLL_UP" ? "up" : "down";
			await computer.scroll({ direction, amount: options.scrollAmount ?? DEFAULT_SCROLL_AMOUNT });
			return { status: "ran", route: "synthetic", detail: `scrolled ${direction}` };
		}
		case "PRESS_RETURN": {
			await computer.key("return");
			return { status: "ran", route: "synthetic", detail: "pressed Return" };
		}
		case "PRESS_ESCAPE": {
			await computer.key("escape");
			return { status: "ran", route: "synthetic", detail: "pressed Escape" };
		}
		case "WAIT": {
			await delay(options.waitMilliseconds ?? DEFAULT_WAIT_MILLISECONDS);
			return { status: "ran", route: "none", detail: "waited for the interface to settle" };
		}
		case "DONE":
		case "BLOCKED": {
			return { status: "ran", route: "none", detail: `no input: ${decision.operation}` };
		}
	}
}

/** What the phone can be told to do, satisfied structurally by `IPhoneMirroring`. */
export interface PhoneHands {
	observe(): Promise<MirroringObservation>;
	tap(x: number, y: number): Promise<void>;
	typeText(text: string): Promise<void>;
	scroll(direction: "up" | "down", options?: { readonly amount?: number }): Promise<void>;
}

export interface PhoneAdapterOptions {
	readonly hands: PhoneHands;
	readonly app?: string;
	readonly maxTargets?: number;
	readonly scrollAmount?: number;
}

export function phoneAdapter(options: PhoneAdapterOptions): PlatformAdapter<MirroringObservation> {
	return {
		platform: "ios",
		async observe(): Promise<Observation<MirroringObservation>> {
			const observation = await options.hands.observe();
			const space = buildPhoneActionSpace(observation, {
				app: options.app ?? "iPhone",
				...(options.maxTargets === undefined ? {} : { maxTargets: options.maxTargets }),
			});
			return { space, state: observation };
		},
		async execute(observation: Observation<MirroringObservation>, decision: Decision): Promise<ExecutionResult> {
			const texts = observation.state.texts;
			try {
				switch (decision.operation) {
					case "PRESS": {
						const target = requireTarget(decision);
						const entry = texts[target.index];
						if (entry === undefined || entry.text !== target.expectLabel) {
							return {
								status: "refused",
								route: "none",
								detail: "stale-observation: the screen no longer shows that text",
							};
						}
						await options.hands.tap(entry.x + entry.width / 2, entry.y + entry.height / 2);
						return { status: "ran", route: "synthetic", detail: `tapped ${target.label}` };
					}
					case "TYPE_TEXT": {
						if (decision.text === undefined || decision.text === "") {
							return { status: "refused", route: "none", detail: "TYPE_TEXT ran without a value to write" };
						}
						await options.hands.typeText(decision.text);
						return {
							status: "ran",
							route: "synthetic",
							detail: `typed ${decision.text.length} characters into the focused field`,
						};
					}
					case "SCROLL_UP":
					case "SCROLL_DOWN": {
						await options.hands.scroll(decision.operation === "SCROLL_UP" ? "up" : "down", {
							amount: options.scrollAmount ?? 0.3,
						});
						return {
							status: "ran",
							route: "synthetic",
							detail: `scrolled ${decision.operation === "SCROLL_UP" ? "up" : "down"}`,
						};
					}
					case "WAIT": {
						await delay(DEFAULT_WAIT_MILLISECONDS);
						return { status: "ran", route: "none", detail: "waited for the screen to settle" };
					}
					case "DONE":
					case "BLOCKED": {
						return { status: "ran", route: "none", detail: `no input: ${decision.operation}` };
					}
					default: {
						return {
							status: "refused",
							route: "none",
							detail: `${decision.operation} is not offered on the phone`,
						};
					}
				}
			} catch (error) {
				return { status: "failed", route: "none", detail: messageOf(error) };
			}
		},
	};
}

async function resolvePid(computer: ComputerInterface, app: string): Promise<number> {
	const apps = await computer.listApps();
	const match = apps.find((entry) => entry.bundleId === app || entry.name === app);
	if (match === undefined) {
		throw new Error(`no running app matches ${JSON.stringify(app)}`);
	}
	return match.pid;
}

function requireTarget(decision: Decision): NonNullable<Decision["target"]> {
	const target = decision.target;
	if (target === undefined) {
		throw new Error(`${decision.operation} reached the executor without a target`);
	}
	return target;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function delay(milliseconds: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

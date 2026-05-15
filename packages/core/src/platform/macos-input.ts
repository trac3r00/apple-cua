import { setTimeout as sleep } from "node:timers/promises";
import { openWindows } from "get-windows";
import type { DragOptions, KeyOptions, Point, ScrollOptions } from "../types/index.js";
import {
	K_CG_EVENT_FLAG_MASK_ALTERNATE,
	K_CG_EVENT_FLAG_MASK_COMMAND,
	K_CG_EVENT_FLAG_MASK_CONTROL,
	K_CG_EVENT_FLAG_MASK_SHIFT,
	type MouseButton,
	getCurrentCursorPosition,
	postKeyboardEvent,
	postMouseEvent,
	postScrollEvent,
	postUnicodeText,
} from "./macos-ffi/coregraphics.js";
import { type SkyLightTargetWindow, activateWindowWithoutRaise } from "./macos-ffi/skylight.js";

const DEFAULT_DRAG_FRAME_MILLISECONDS = 16;
const MAX_DRAG_STEPS = 60;

const VIRTUAL_KEY_CODES = new Map<string, number>([
	["a", 0],
	["s", 1],
	["d", 2],
	["f", 3],
	["h", 4],
	["g", 5],
	["z", 6],
	["x", 7],
	["c", 8],
	["v", 9],
	["b", 11],
	["q", 12],
	["w", 13],
	["e", 14],
	["r", 15],
	["y", 16],
	["t", 17],
	["1", 18],
	["2", 19],
	["3", 20],
	["4", 21],
	["6", 22],
	["5", 23],
	["=", 24],
	["9", 25],
	["7", 26],
	["-", 27],
	["8", 28],
	["0", 29],
	["]", 30],
	["o", 31],
	["u", 32],
	["[", 33],
	["i", 34],
	["p", 35],
	["return", 36],
	["enter", 36],
	["l", 37],
	["j", 38],
	["'", 39],
	["k", 40],
	[";", 41],
	["\\", 42],
	[",", 43],
	["/", 44],
	["n", 45],
	["m", 46],
	[".", 47],
	["tab", 48],
	["space", 49],
	[" ", 49],
	["grave", 50],
	["`", 50],
	["delete", 51],
	["backspace", 51],
	["escape", 53],
	["esc", 53],
	["command", 55],
	["cmd", 55],
	["meta", 55],
	["shift", 56],
	["capslock", 57],
	["option", 58],
	["alt", 58],
	["control", 59],
	["ctrl", 59],
	["rightshift", 60],
	["rightoption", 61],
	["rightalt", 61],
	["rightcontrol", 62],
	["rightctrl", 62],
	["fn", 63],
	["f17", 64],
	["f5", 96],
	["f6", 97],
	["f7", 98],
	["f3", 99],
	["f8", 100],
	["f9", 101],
	["f11", 103],
	["f13", 105],
	["f16", 106],
	["f14", 107],
	["f10", 109],
	["f12", 111],
	["f15", 113],
	["help", 114],
	["home", 115],
	["pageup", 116],
	["forwarddelete", 117],
	["f4", 118],
	["end", 119],
	["f2", 120],
	["pagedown", 121],
	["f1", 122],
	["left", 123],
	["arrowleft", 123],
	["right", 124],
	["arrowright", 124],
	["down", 125],
	["arrowdown", 125],
	["up", 126],
	["arrowup", 126],
]);

export class MacOSInputController {
	private targetPid: number | undefined;
	private lastTargetWindow: SkyLightTargetWindow | undefined;
	private readonly targetWindowsByPid = new Map<number, SkyLightTargetWindow>();

	constructor(targetPid?: number) {
		this.setTarget(targetPid);
	}

	setTarget(pid?: number): void {
		if (pid !== undefined && (!Number.isSafeInteger(pid) || pid <= 0)) {
			throw new Error("target pid must be a positive integer");
		}
		this.targetPid = pid;
		this.lastTargetWindow = pid === undefined ? undefined : this.targetWindowsByPid.get(pid);
	}

	async rememberTargetWindow(pid: number): Promise<SkyLightTargetWindow | undefined> {
		if (!Number.isSafeInteger(pid) || pid <= 0) {
			throw new Error("target pid must be a positive integer");
		}
		const targetWindow = await this.visibleWindowForPid(pid);
		if (targetWindow !== undefined) {
			this.targetWindowsByPid.set(pid, targetWindow);
			if (this.targetPid === pid) {
				this.lastTargetWindow = targetWindow;
			}
		}
		return targetWindow;
	}

	async move(position: Point): Promise<void> {
		await this.postMouse("move", position, "left", undefined, await this.targetWindow(position));
	}

	async click(position: Point, button: MouseButton = "left"): Promise<void> {
		const targetWindow = await this.targetWindow(position);
		this.requirePointerWindow(targetWindow);
		this.lastTargetWindow = targetWindow;
		if (button === "left" && targetWindow !== undefined) {
			activateWindowWithoutRaise(targetWindow);
			await sleep(50);
			await this.postMouse("move", position, "left", undefined, targetWindow);
			await sleep(15);
		}
		if (this.targetPid === undefined) {
			await this.move(position);
		}
		await this.postMouse("down", position, button, 1, targetWindow);
		await this.postMouse("up", position, button, 1, targetWindow);
	}

	async doubleClick(position: Point): Promise<void> {
		const targetWindow = await this.targetWindow(position);
		this.requirePointerWindow(targetWindow);
		this.lastTargetWindow = targetWindow;
		if (targetWindow !== undefined) {
			activateWindowWithoutRaise(targetWindow);
			await sleep(50);
		}
		if (this.targetPid === undefined) {
			await this.move(position);
		}
		await this.postMouse("down", position, "left", 1, targetWindow);
		await this.postMouse("up", position, "left", 1, targetWindow);
		await this.postMouse("down", position, "left", 2, targetWindow);
		await this.postMouse("up", position, "left", 2, targetWindow);
	}

	async typeText(text: string): Promise<void> {
		const targetWindow = await this.requireSessionWindow("keyboard");
		for (const segment of Array.from(text)) {
			postUnicodeText(segment, this.targetPid, targetWindow);
		}
	}

	async pressKey(key: string, options?: KeyOptions): Promise<void> {
		const keyCode = virtualKeyCodeFor(key);
		const flags = modifierFlags(options?.modifiers ?? []);
		const targetWindow = await this.requireSessionWindow("keyboard");
		postKeyboardEvent({
			keyCode,
			keyDown: true,
			flags,
			text: undefined,
			targetPid: this.targetPid,
			targetWindow,
		});
		postKeyboardEvent({
			keyCode,
			keyDown: false,
			flags,
			text: undefined,
			targetPid: this.targetPid,
			targetWindow,
		});
	}

	async scroll(options: ScrollOptions): Promise<void> {
		const amount = Math.trunc(options.amount);
		const targetWindow = await this.requireSessionWindow("scroll");
		switch (options.direction) {
			case "up":
				postScrollEvent({ deltaX: 0, deltaY: amount, targetPid: this.targetPid, targetWindow });
				return;
			case "down":
				postScrollEvent({ deltaX: 0, deltaY: -amount, targetPid: this.targetPid, targetWindow });
				return;
			case "left":
				postScrollEvent({ deltaX: -amount, deltaY: 0, targetPid: this.targetPid, targetWindow });
				return;
			case "right":
				postScrollEvent({ deltaX: amount, deltaY: 0, targetPid: this.targetPid, targetWindow });
				return;
		}
	}

	async drag(options: DragOptions): Promise<void> {
		const targetWindow = await this.targetWindow(options.from);
		this.requirePointerWindow(targetWindow);
		this.lastTargetWindow = targetWindow;
		if (targetWindow !== undefined) {
			activateWindowWithoutRaise(targetWindow);
			await sleep(50);
		}
		if (this.targetPid === undefined) {
			await this.move(options.from);
		}
		await this.postMouse("down", options.from, "left", 1, targetWindow);

		const duration = options.duration ?? 0;
		const steps = dragSteps(duration);
		const delay = steps <= 1 ? 0 : duration / steps;
		for (let step = 1; step <= steps; step += 1) {
			const position = interpolatePoint(options.from, options.to, step / steps);
			await this.postMouse("drag", position, "left", 1, targetWindow);
			if (delay > 0 && step < steps) {
				await sleep(delay);
			}
		}

		await this.postMouse("up", options.to, "left", 1, targetWindow);
	}

	getCursorPosition(): Point {
		const position = getCurrentCursorPosition();
		return { x: Math.round(position.x), y: Math.round(position.y) };
	}

	close(): void {}

	private async postMouse(
		kind: "move" | "down" | "up" | "drag",
		position: Point,
		button: MouseButton,
		clickState: number | undefined,
		targetWindow: SkyLightTargetWindow | undefined,
	): Promise<void> {
		postMouseEvent({ kind, position, button, clickState, targetPid: this.targetPid, targetWindow });
	}

	private async targetWindow(position: Point): Promise<SkyLightTargetWindow | undefined> {
		if (this.targetPid === undefined) {
			return undefined;
		}
		const targetWindow = await this.visibleWindowForPid(this.targetPid, position);
		if (targetWindow !== undefined) {
			this.targetWindowsByPid.set(this.targetPid, targetWindow);
		}
		return targetWindow;
	}

	private async visibleWindowForPid(pid: number, position?: Point): Promise<SkyLightTargetWindow | undefined> {
		const windows = await openWindows();
		const match = windows.find(
			(window) => window.owner.processId === pid && window.bounds.width > 0 && window.bounds.height > 0,
		);
		const containingMatch =
			position === undefined
				? undefined
				: windows.find(
						(window) =>
							window.owner.processId === pid &&
							window.bounds.width > 0 &&
							window.bounds.height > 0 &&
							position.x >= window.bounds.x &&
							position.x <= window.bounds.x + window.bounds.width &&
							position.y >= window.bounds.y &&
							position.y <= window.bounds.y + window.bounds.height,
					);
		const target = containingMatch ?? match;
		if (target === undefined) {
			return undefined;
		}
		return {
			id: target.id,
			bounds: {
				x: target.bounds.x,
				y: target.bounds.y,
				width: target.bounds.width,
				height: target.bounds.height,
			},
		};
	}

	private requirePointerWindow(targetWindow: SkyLightTargetWindow | undefined): void {
		if (this.targetPid !== undefined && targetWindow === undefined) {
			throw new Error("targeted pointer input requires get_app_state or a visible target window");
		}
	}

	private async requireSessionWindow(action: "keyboard" | "scroll"): Promise<SkyLightTargetWindow | undefined> {
		if (this.targetPid === undefined) {
			return undefined;
		}
		if (this.lastTargetWindow !== undefined) {
			return this.lastTargetWindow;
		}
		const targetWindow = await this.visibleWindowForPid(this.targetPid);
		if (targetWindow === undefined) {
			throw new Error(
				`targeted ${action} input requires get_app_state, a visible target window, or a prior pointer action`,
			);
		}
		this.targetWindowsByPid.set(this.targetPid, targetWindow);
		this.lastTargetWindow = targetWindow;
		return this.lastTargetWindow;
	}
}

function virtualKeyCodeFor(key: string): number {
	const normalizedKey = normalizeKey(key);
	const keyCode = VIRTUAL_KEY_CODES.get(normalizedKey);
	if (keyCode === undefined) {
		throw new Error(`unsupported key: ${key}`);
	}
	return keyCode;
}

function normalizeKey(key: string): string {
	const trimmed = key.trim();
	return trimmed.length === 1 ? trimmed.toLowerCase() : trimmed.toLowerCase().replaceAll(" ", "");
}

function modifierFlags(modifiers: NonNullable<KeyOptions["modifiers"]>): number {
	let flags = 0;
	for (const modifier of modifiers) {
		switch (modifier) {
			case "command":
			case "cmd":
				flags |= K_CG_EVENT_FLAG_MASK_COMMAND;
				break;
			case "option":
			case "alt":
				flags |= K_CG_EVENT_FLAG_MASK_ALTERNATE;
				break;
			case "control":
			case "ctrl":
				flags |= K_CG_EVENT_FLAG_MASK_CONTROL;
				break;
			case "shift":
				flags |= K_CG_EVENT_FLAG_MASK_SHIFT;
				break;
		}
	}
	return flags;
}

function dragSteps(duration: number): number {
	if (duration <= 0) {
		return 1;
	}
	return Math.max(1, Math.min(MAX_DRAG_STEPS, Math.ceil(duration / DEFAULT_DRAG_FRAME_MILLISECONDS)));
}

function interpolatePoint(from: Point, to: Point, progress: number): Point {
	return {
		x: Math.round(from.x + (to.x - from.x) * progress),
		y: Math.round(from.y + (to.y - from.y) * progress),
	};
}

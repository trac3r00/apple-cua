import { setTimeout as sleep } from "node:timers/promises";
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
import { MacOSCuaHelper } from "./macos-helper.js";

const DEFAULT_DRAG_FRAME_MILLISECONDS = 16;
const MAX_DRAG_STEPS = 60;
const TARGET_TEXT_EVENT_DELAY_MILLISECONDS = 12;

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
	private readonly helper = new MacOSCuaHelper();

	constructor(targetPid?: number) {
		this.setTarget(targetPid);
	}

	setTarget(pid?: number): void {
		if (pid !== undefined && (!Number.isSafeInteger(pid) || pid <= 0)) {
			throw new Error("target pid must be a positive integer");
		}
		this.targetPid = pid;
	}

	async move(position: Point): Promise<void> {
		if (this.targetPid !== undefined) {
			await this.helper.movePid(this.targetPid, position);
			return;
		}
		this.postMouse("move", position, "left", undefined);
	}

	async click(position: Point, button: MouseButton = "left"): Promise<void> {
		if (this.targetPid !== undefined) {
			await this.clickPid(this.targetPid, position, button);
			return;
		}
		await this.move(position);
		this.postMouse("down", position, button, 1);
		this.postMouse("up", position, button, 1);
	}

	async doubleClick(position: Point): Promise<void> {
		if (this.targetPid !== undefined) {
			await this.helper.doubleClickPid(this.targetPid, position);
			return;
		}
		await this.move(position);
		this.postMouse("down", position, "left", 1);
		this.postMouse("up", position, "left", 1);
		this.postMouse("down", position, "left", 2);
		this.postMouse("up", position, "left", 2);
	}

	async typeText(text: string): Promise<void> {
		if (this.targetPid !== undefined) {
			await this.helper.typeTextPid(this.targetPid, text);
			return;
		}
		for (const segment of Array.from(text)) {
			postUnicodeText(segment, undefined);
		}
	}

	async pressKey(key: string, options?: KeyOptions): Promise<void> {
		if (this.targetPid !== undefined) {
			await this.helper.keyPid(this.targetPid, key, options);
			return;
		}
		const keyCode = virtualKeyCodeFor(key);
		const flags = modifierFlags(options?.modifiers ?? []);
		postKeyboardEvent({ keyCode, keyDown: true, flags, text: undefined, targetPid: undefined });
		postKeyboardEvent({ keyCode, keyDown: false, flags, text: undefined, targetPid: undefined });
	}

	async scroll(options: ScrollOptions): Promise<void> {
		const amount = Math.trunc(options.amount);
		if (this.targetPid !== undefined) {
			await this.scrollPid(this.targetPid, options.direction, amount);
			return;
		}
		switch (options.direction) {
			case "up":
				postScrollEvent({ deltaX: 0, deltaY: amount, targetPid: undefined });
				return;
			case "down":
				postScrollEvent({ deltaX: 0, deltaY: -amount, targetPid: undefined });
				return;
			case "left":
				postScrollEvent({ deltaX: -amount, deltaY: 0, targetPid: undefined });
				return;
			case "right":
				postScrollEvent({ deltaX: amount, deltaY: 0, targetPid: undefined });
				return;
		}
	}

	async drag(options: DragOptions): Promise<void> {
		if (this.targetPid !== undefined) {
			await this.helper.dragPid(this.targetPid, options);
			return;
		}
		await this.move(options.from);
		this.postMouse("down", options.from, "left", 1);

		const duration = options.duration ?? 0;
		const steps = dragSteps(duration);
		const delay = steps <= 1 ? 0 : duration / steps;
		for (let step = 1; step <= steps; step += 1) {
			const position = interpolatePoint(options.from, options.to, step / steps);
			this.postMouse("drag", position, "left", 1);
			if (delay > 0 && step < steps) {
				await sleep(delay);
			}
		}

		this.postMouse("up", options.to, "left", 1);
	}

	getCursorPosition(): Point {
		const position = getCurrentCursorPosition();
		return { x: Math.round(position.x), y: Math.round(position.y) };
	}

	close(): void {
		this.helper.close();
	}

	private postMouse(
		kind: "move" | "down" | "up" | "drag",
		position: Point,
		button: MouseButton,
		clickState: number | undefined,
	): void {
		postMouseEvent({ kind, position, button, clickState, targetPid: undefined });
	}

	private async clickPid(pid: number, position: Point, button: MouseButton): Promise<void> {
		switch (button) {
			case "left":
				await this.helper.clickPid(pid, position);
				return;
			case "right":
				await this.helper.rightClickPid(pid, position);
				return;
			case "middle":
				await this.helper.middleClickPid(pid, position);
				return;
		}
	}

	private async scrollPid(pid: number, direction: ScrollOptions["direction"], amount: number): Promise<void> {
		const key = scrollKeyFor(direction);
		for (let index = 0; index < Math.max(0, amount); index += 1) {
			await this.helper.keyPid(pid, key, { modifiers: [] });
			await sleep(TARGET_TEXT_EVENT_DELAY_MILLISECONDS);
		}
	}
}

function scrollKeyFor(direction: ScrollOptions["direction"]): string {
	switch (direction) {
		case "up":
			return "pageup";
		case "down":
			return "pagedown";
		case "left":
			return "left";
		case "right":
			return "right";
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

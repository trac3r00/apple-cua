import type { KeyOptions } from "../types/index.js";
import {
	K_CG_EVENT_FLAG_MASK_ALTERNATE,
	K_CG_EVENT_FLAG_MASK_COMMAND,
	K_CG_EVENT_FLAG_MASK_CONTROL,
	K_CG_EVENT_FLAG_MASK_SHIFT,
} from "./macos-ffi/coregraphics.js";

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

export function virtualKeyCodeFor(key: string): number {
	const normalizedKey = normalizeKey(key);
	const keyCode = VIRTUAL_KEY_CODES.get(normalizedKey);
	if (keyCode === undefined) {
		throw new Error(`unsupported key: ${key}`);
	}
	return keyCode;
}

export function modifierFlags(modifiers: NonNullable<KeyOptions["modifiers"]>): number {
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

function normalizeKey(key: string): string {
	const trimmed = key.trim();
	return trimmed.length === 1 ? trimmed.toLowerCase() : trimmed.toLowerCase().replaceAll(" ", "");
}

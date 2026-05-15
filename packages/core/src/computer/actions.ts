import type { AppState } from "../accessibility/types.js";
import { resolveElementCoordinate } from "../platform/macos-accessibility.js";
import type { AppStateOptions } from "../types/index.js";
import type { ComputerInterface } from "./interface.js";

export type ComputerUseMouseButton = "left" | "right" | "middle";

type KeyModifier = "command" | "option" | "control" | "shift";

const MODIFIER_ALIASES = new Map<string, KeyModifier>([
	["cmd", "command"],
	["command", "command"],
	["meta", "command"],
	["super", "command"],
	["alt", "option"],
	["option", "option"],
	["ctrl", "control"],
	["control", "control"],
	["shift", "shift"],
]);

export async function resolveAppPid(computer: ComputerInterface, app: string): Promise<number> {
	const normalizedApp = app.trim().toLowerCase();
	if (normalizedApp.length === 0) {
		throw new Error("app must be a non-empty app name, bundle id, or pid");
	}

	const numericPid = Number(normalizedApp);
	if (Number.isSafeInteger(numericPid) && numericPid > 0) {
		return numericPid;
	}

	const apps = await computer.listApps();
	const exactMatch = apps.find((candidate) => {
		const name = candidate.name.toLowerCase();
		const bundleId = candidate.bundleId.toLowerCase();
		return name === normalizedApp || bundleId === normalizedApp;
	});
	if (exactMatch !== undefined) {
		return exactMatch.pid;
	}

	const fuzzyMatch = apps.find((candidate) => {
		const name = candidate.name.toLowerCase();
		const bundleId = candidate.bundleId.toLowerCase();
		return name.includes(normalizedApp) || bundleId.includes(normalizedApp);
	});
	if (fuzzyMatch !== undefined) {
		return fuzzyMatch.pid;
	}

	throw new Error(`No running app matched "${app}"`);
}

export async function getAppStateForApp(
	computer: ComputerInterface,
	app: string,
	options?: AppStateOptions,
): Promise<AppState> {
	return await computer.getAppState(await resolveAppPid(computer, app), options);
}

export async function withTargetedApp<TValue>(
	computer: ComputerInterface,
	targetPid: number,
	action: () => Promise<TValue>,
): Promise<TValue> {
	computer.setTarget(targetPid);
	try {
		return await action();
	} finally {
		computer.setTarget(undefined);
	}
}

export async function resolvePointForElement(
	computer: ComputerInterface,
	targetPid: number,
	elementIndex: number,
): Promise<{ x: number; y: number }> {
	const state = await computer.getAppState(targetPid);
	return resolveElementCoordinate(state.elements, elementIndex);
}

export function parseElementIndex(elementIndex: string | number): number {
	const index = typeof elementIndex === "number" ? elementIndex : Number(elementIndex.trim());
	if (!Number.isSafeInteger(index) || index < 0) {
		throw new Error(`Invalid element index: ${String(elementIndex)}`);
	}
	return index;
}

export function parseKeyChord(key: string): { readonly key: string; readonly modifiers: KeyModifier[] } {
	const parts = key
		.split("+")
		.map((part) => part.trim())
		.filter(Boolean);
	const finalKey = parts.at(-1);
	if (finalKey === undefined) {
		throw new Error("key must be non-empty");
	}
	const modifiers = parts.slice(0, -1).map((part) => {
		const modifier = MODIFIER_ALIASES.get(part.toLowerCase());
		if (modifier === undefined) {
			throw new Error(`unsupported key modifier: ${part}`);
		}
		return modifier;
	});
	return { key: finalKey, modifiers };
}

export async function clickPoint(
	computer: ComputerInterface,
	point: { readonly x: number; readonly y: number },
	button: ComputerUseMouseButton,
	clickCount: number,
): Promise<void> {
	const count = Math.max(1, Math.trunc(clickCount));
	if (button === "left" && count === 2) {
		await computer.doubleClick(point);
		return;
	}
	for (let index = 0; index < count; index += 1) {
		switch (button) {
			case "left":
				await computer.click(point);
				break;
			case "right":
				await computer.rightClick(point);
				break;
			case "middle":
				await computer.middleClick(point);
				break;
		}
	}
}

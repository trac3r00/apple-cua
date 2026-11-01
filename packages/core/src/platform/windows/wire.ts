import type { AXTreeElement, AppInfo, AppState, WindowInventoryEntry } from "../../accessibility/types.js";
import type { Point, Rect } from "../../types/index.js";
import { WindowsHostError } from "./transport.js";

export function record(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new WindowsHostError("PROTOCOL", "Expected an object");
	}
	return Object.fromEntries(Object.entries(value));
}

export function string(value: unknown): string {
	if (typeof value !== "string") throw new WindowsHostError("PROTOCOL", "Expected a string");
	return value;
}

export function number(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new WindowsHostError("PROTOCOL", "Expected a finite number");
	}
	return value;
}

export function boolean(value: unknown): boolean {
	if (typeof value !== "boolean") throw new WindowsHostError("PROTOCOL", "Expected a boolean");
	return value;
}

export function array(value: unknown): unknown[] {
	if (!Array.isArray(value)) throw new WindowsHostError("PROTOCOL", "Expected an array");
	return value;
}

export function point(value: unknown): Point {
	const r = record(value);
	return { x: number(r["x"]), y: number(r["y"]) };
}

export function rect(value: unknown): Rect {
	const r = record(value);
	return { ...point(r), width: number(r["width"]), height: number(r["height"]) };
}

export function windowEntry(value: unknown): WindowInventoryEntry {
	const r = record(value);
	return { id: number(r["id"]), title: string(r["title"]), bounds: rect(r["bounds"]) };
}

export function app(value: unknown): AppInfo {
	const r = record(value);
	return {
		name: string(r["name"]),
		bundleId: string(r["bundleId"]),
		pid: number(r["pid"]),
		isRunning: boolean(r["isRunning"]),
		isFrontmost: boolean(r["isFrontmost"]),
	};
}

function element(value: unknown): AXTreeElement {
	const r = record(value);
	return {
		id: number(r["id"]),
		role: string(r["role"]),
		label: r["label"] === null ? null : string(r["label"]),
		value: r["value"] === null ? null : string(r["value"]),
		frame: rect(r["frame"]),
		actions: array(r["actions"]).map(string),
		children: array(r["children"]).map(number),
	};
}

export function state(value: unknown): AppState {
	const r = record(value);
	const display = record(r["display"]);
	const treeSkipped = boolean(r["treeSkipped"]);
	return {
		app: string(r["app"]),
		bundleId: string(r["bundleId"]),
		pid: number(r["pid"]),
		frontmost: boolean(r["frontmost"]),
		axAvailable: boolean(r["axAvailable"]),
		elements: array(r["elements"]).map(element),
		observationKey: string(r["observationKey"]),
		screenshotBase64: string(r["screenshotBase64"]),
		screenshotWidth: number(r["screenshotWidth"]),
		screenshotHeight: number(r["screenshotHeight"]),
		screenshotMimeType: "image/png",
		display: {
			width: number(display["width"]),
			height: number(display["height"]),
			scaleFactor: number(display["scaleFactor"]),
		},
		windowBounds: rect(r["windowBounds"]),
		windowId: number(r["windowId"]),
		windowTitle: string(r["windowTitle"]),
		windowCandidates: array(r["windowCandidates"]).map(windowEntry),
		elementsTruncated: boolean(r["elementsTruncated"]),
		treeSkipped,
	};
}

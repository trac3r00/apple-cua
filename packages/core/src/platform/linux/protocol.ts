import type { AXTreeElement, AppInfo, WindowInventoryEntry } from "../../accessibility/types.js";
import type { Point, Rect } from "../../types/index.js";
import { LinuxBackendError, record } from "./client.js";

export function number(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new LinuxBackendError("PROTOCOL_ERROR", "Expected finite number");
	}
	return value;
}

export function text(value: unknown): string {
	if (typeof value !== "string") throw new LinuxBackendError("PROTOCOL_ERROR", "Expected string");
	return value;
}

export function boolean(value: unknown): boolean {
	if (typeof value !== "boolean") throw new LinuxBackendError("PROTOCOL_ERROR", "Expected boolean");
	return value;
}

export function array(value: unknown): unknown[] {
	if (!Array.isArray(value)) throw new LinuxBackendError("PROTOCOL_ERROR", "Expected array");
	return value;
}

export function point(value: unknown): Point {
	const data = record(value);
	return { x: number(data["x"]), y: number(data["y"]) };
}

export function size(value: unknown): { width: number; height: number } {
	const data = record(value);
	return { width: number(data["width"]), height: number(data["height"]) };
}

export function rect(value: unknown): Rect {
	return { ...point(value), ...size(value) };
}

export function app(value: unknown): AppInfo {
	const data = record(value);
	return {
		name: text(data["name"]),
		bundleId: text(data["bundleId"]),
		pid: number(data["pid"]),
		isRunning: true,
		isFrontmost: boolean(data["isFrontmost"]),
	};
}

export function window(value: unknown): WindowInventoryEntry {
	const data = record(value);
	return { id: number(data["id"]), title: text(data["title"]), bounds: rect(data["bounds"]) };
}

export function element(value: unknown): AXTreeElement {
	const data = record(value);
	return {
		id: number(data["id"]),
		role: text(data["role"]),
		label: data["label"] === null ? null : text(data["label"]),
		value: data["value"] === null ? null : text(data["value"]),
		frame: rect(data["frame"]),
		actions: array(data["actions"]).map(text),
		children: array(data["children"]).map(number),
	};
}

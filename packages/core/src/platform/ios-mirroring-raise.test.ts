import { beforeEach, describe, expect, it } from "bun:test";
import { vi } from "@apple-cua/test-support";

const native = vi.hoisted(() => ({
	root: {},
	windows: {},
	window: {},
	front: {},
	references: 1,
	liveAtRaise: false,
	raiseFails: false,
	bounds: { x: 100, y: 200, width: 300, height: 600 },
}));

vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn(async () => undefined) }));
const actualWorkspace = { ...(await import("./macos-ffi/workspace.js")) };
vi.mock("./macos-ffi/workspace.js", () => ({
	...actualWorkspace,
	findRunningApplication: vi.fn(() => ({ pid: 9001, name: "iPhone Mirroring" })),
	activateApplication: vi.fn(),
}));
const actualWindowList = { ...(await import("./macos-ffi/window-list.js")) };
vi.mock("./macos-ffi/window-list.js", () => ({
	...actualWindowList,
	listWindows: vi.fn(() => [
		{ id: 5, ownerPid: 9001, layer: 0, ownerName: "iPhone Mirroring", title: "", bounds: native.bounds },
	]),
}));
vi.mock("./macos-top-level-windows.js", () => ({
	listTopLevelWindows: vi.fn(async () => [{ id: 5, ownerPid: 9001, bounds: native.bounds }]),
}));
const actualAccessibility = { ...(await import("./macos-ffi/accessibility.js")) };
vi.mock("./macos-ffi/accessibility.js", () => ({
	...actualAccessibility,
	createApplicationElement: vi.fn(() => native.root),
	copyAttributeValue: vi.fn(() => native.windows),
	copyOptionalAttributeValue: vi.fn(() => native.front),
	elementFrame: vi.fn(() => native.bounds),
	releaseAXElement: vi.fn((reference: object) => {
		if (reference === native.window) native.references--;
	}),
	windowTitlesForPid: vi.fn(() => new Map([[5, "iPhone Mirroring"]])),
	performAction: vi.fn(() => {
		native.liveAtRaise = native.references > 0;
		if (native.raiseFails) throw new Error("AXRaise failed");
	}),
}));
const actualCorefoundation = { ...(await import("./macos-ffi/corefoundation.js")) };
vi.mock("./macos-ffi/corefoundation.js", () => ({
	...actualCorefoundation,
	isCFArray: vi.fn((reference: object) => reference === native.windows),
	cfArrayLength: vi.fn(() => 1),
	cfArrayValueAt: vi.fn(() => native.window),
	cfRetain: vi.fn((reference: object) => {
		if (reference === native.window) native.references++;
		return reference;
	}),
	cfRelease: vi.fn((reference: object) => {
		if (reference === native.windows) native.references--;
	}),
	isCFBoolean: vi.fn((reference: object) => reference === native.front),
	fromCFBoolean: vi.fn(() => true),
}));

const { activateMirroring } = await import("./ios-mirroring.js");

beforeEach(() => {
	native.references = 1;
	native.liveAtRaise = false;
	native.raiseFails = false;
});

describe("#given an AX window owned by a copied array #when raising it #then its lifetime covers the action", () => {
	it.each([false, true])("keeps the window live and balances ownership with raiseFails=%s", async (raiseFails) => {
		native.raiseFails = raiseFails;

		await activateMirroring();

		expect(native.liveAtRaise).toBe(true);
		expect(native.references).toBe(0);
	});
});

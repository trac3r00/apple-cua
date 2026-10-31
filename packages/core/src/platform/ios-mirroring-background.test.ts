import { beforeEach, describe, expect, it } from "bun:test";
import { vi } from "@apple-cua/test-support";

const native = vi.hoisted(() => ({ activateApplication: vi.fn() }));

const actualWorkspace = { ...(await import("./macos-ffi/workspace.js")) };
vi.mock("./macos-ffi/workspace.js", () => ({
	...actualWorkspace,
	activateApplication: native.activateApplication,
}));
const actualMacosTopLevelWindows = { ...(await import("./macos-top-level-windows.js")) };
vi.mock("./macos-top-level-windows.js", () => ({
	...actualMacosTopLevelWindows,
	listTopLevelWindows: vi.fn(async () => [
		{ id: 1, ownerPid: 4242, bounds: { x: 100, y: 200, width: 300, height: 600 } },
	]),
}));
vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn(async () => undefined) }));

const { requireMirroringWindowAt } = await import("./ios-mirroring.js");

beforeEach(() => {
	native.activateApplication.mockClear();
});

describe("#given a covered phone window #when background delivery checks the gesture point #then refuses without raising", () => {
	it("rejects instead of bringing the phone forward", async () => {
		await expect(requireMirroringWindowAt(9001, { x: 150, y: 250 }, { allowActivation: false })).rejects.toThrow(
			/background delivery refuses to raise/,
		);
		expect(native.activateApplication).not.toHaveBeenCalled();
	});
});

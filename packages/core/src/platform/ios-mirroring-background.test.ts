import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ activateApplication: vi.fn() }));

vi.mock("./macos-ffi/workspace.js", async (original) => ({
	...(await original<typeof import("./macos-ffi/workspace.js")>()),
	activateApplication: native.activateApplication,
}));
vi.mock("./macos-top-level-windows.js", async (original) => ({
	...(await original<typeof import("./macos-top-level-windows.js")>()),
	listTopLevelWindows: vi.fn(async () => [
		{ id: 1, ownerPid: 4242, bounds: { x: 100, y: 200, width: 300, height: 600 } },
	]),
}));
vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn(async () => undefined) }));

import { requireMirroringWindowAt } from "./ios-mirroring.js";

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

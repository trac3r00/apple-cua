import { beforeEach, describe, expect, it, vi } from "vitest";

const accessibilityMock = vi.hoisted(() => ({ pressElementAtScreenPoint: vi.fn(() => false) }));

vi.mock("./macos-ffi/accessibility.js", () => accessibilityMock);
vi.mock("./macos-ffi/lock-screen.js", () => ({ isScreenLocked: () => false }));

import { runInInputScope } from "../computer/input-scope.js";
import { NOOP_POINTER_OVERLAY } from "./macos-ffi/cursor-overlay.js";
import { MacOSHostComputer } from "./macos.js";

beforeEach(() => accessibilityMock.pressElementAtScreenPoint.mockClear());

describe("#given an accessibility press at a screen point #when it runs inside a dispatch #then it is held to that dispatch's window", () => {
	it("#given a different default app #when pressing an explicit pid #then feedback belongs to that pid", async () => {
		const set = vi.fn();
		const computer = new MacOSHostComputer({
			defaultTargetPid: 5678,
			overlay: { ...NOOP_POINTER_OVERLAY, set },
			delivery: "attended",
		});
		try {
			await computer.pressAtPosition(1234, { x: 5, y: 6 });
			expect(set).toHaveBeenCalledWith({ x: 5, y: 6 }, 1234);
		} finally {
			await computer.close();
		}
	});

	it("#when the dispatch is bound to an observed window of the app #then only an element of that window may be pressed", async () => {
		// given
		const computer = new MacOSHostComputer({ overlay: NOOP_POINTER_OVERLAY, delivery: "background" });

		// when
		await runInInputScope({ target: { pid: 1234, windowId: 12 } }, () =>
			computer.pressAtPosition(1234, { x: 5, y: 6 }),
		);
		await computer.pressAtPosition(1234, { x: 7, y: 8 });
		await runInInputScope({ target: { pid: 5678, windowId: 99 } }, () =>
			computer.pressAtPosition(1234, { x: 9, y: 10 }),
		);

		// then: the bound window rides along for its own app only
		expect(accessibilityMock.pressElementAtScreenPoint.mock.calls).toEqual([
			[1234, 5, 6, 12],
			[1234, 7, 8, undefined],
			[1234, 9, 10, undefined],
		]);
		await computer.close();
	});
});

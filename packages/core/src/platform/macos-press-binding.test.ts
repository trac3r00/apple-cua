import { beforeEach, describe, expect, it } from "bun:test";
import { vi } from "@apple-cua/test-support";

const accessibilityMock = vi.hoisted(() => ({ pressElementAtScreenPoint: vi.fn(() => false) }));

vi.mock("./macos-ffi/accessibility.js", () => accessibilityMock);
vi.mock("./macos-ffi/lock-screen.js", () => ({ isScreenLocked: () => false }));

const { runInInputScope } = await import("../computer/input-scope.js");
const { NOOP_POINTER_OVERLAY } = await import("./macos-ffi/cursor-overlay.js");
const { MacOSHostComputer } = await import("./macos.js");

beforeEach(() => accessibilityMock.pressElementAtScreenPoint.mockClear());

const HOST_REFUSAL = /host-window cannot operate on the human desktop/;

describe("#given an accessibility press at a screen point on the human desktop #when it runs #then it is refused before any effect", () => {
	it("#given a different default app #when pressing an explicit pid #then no pointer feedback or press happens", async () => {
		const set = vi.fn();
		const computer = new MacOSHostComputer({
			defaultTargetPid: 5678,
			overlay: { ...NOOP_POINTER_OVERLAY, set },
			delivery: "background",
		});
		try {
			await expect(computer.pressAtPosition(1234, { x: 5, y: 6 })).rejects.toThrow(HOST_REFUSAL);
			expect(set).not.toHaveBeenCalled();
			expect(accessibilityMock.pressElementAtScreenPoint).not.toHaveBeenCalled();
		} finally {
			await computer.close();
		}
	});

	it("#when the dispatch is bound to an observed window of the app or not #then no element is pressed", async () => {
		// given
		const computer = new MacOSHostComputer({ overlay: NOOP_POINTER_OVERLAY, delivery: "background" });

		// when
		await expect(
			runInInputScope({ target: { pid: 1234, windowId: 12 } }, () => computer.pressAtPosition(1234, { x: 5, y: 6 })),
		).rejects.toThrow(HOST_REFUSAL);
		await expect(computer.pressAtPosition(1234, { x: 7, y: 8 })).rejects.toThrow(HOST_REFUSAL);
		await expect(
			runInInputScope({ target: { pid: 5678, windowId: 99 } }, () =>
				computer.pressAtPosition(1234, { x: 9, y: 10 }),
			),
		).rejects.toThrow(HOST_REFUSAL);

		// then
		expect(accessibilityMock.pressElementAtScreenPoint).not.toHaveBeenCalled();
		await computer.close();
	});
});

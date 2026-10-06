import { describe, expect, it, vi } from "vitest";

import { withTargetedApp } from "./actions.js";
import { InputInterrupted, assertInputMayContinue, currentInputScope, runInInputScope } from "./input-scope.js";
import type { ComputerInterface } from "./interface.js";

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
	let resolvePromise: (() => void) | undefined;
	const promise = new Promise<void>((resolve) => {
		resolvePromise = resolve;
	});
	return {
		promise,
		resolve(): void {
			resolvePromise?.();
		},
	};
}

/** A computer whose every method is a bare mock: withTargetedApp must aim input without calling any of them. */
function untouchedComputer(): ComputerInterface {
	return {
		capabilities: {
			supportsScreenshot: true,
			supportsInput: true,
			supportsAccessibility: true,
			supportsClipboard: true,
		},
		screenshot: vi.fn(),
		setTarget: vi.fn(),
		move: vi.fn(),
		click: vi.fn(),
		rightClick: vi.fn(),
		middleClick: vi.fn(),
		doubleClick: vi.fn(),
		type: vi.fn(),
		key: vi.fn(),
		scroll: vi.fn(),
		drag: vi.fn(),
		getCursorPosition: vi.fn(),
		getScreenSize: vi.fn(),
		getAppState: vi.fn(),
		assertObservationCurrent: vi.fn(),
		getScreenshotViewport: vi.fn(),
		listApps: vi.fn(),
		setValue: vi.fn(),
		selectText: vi.fn(),
		performAction: vi.fn(),
		pressAtPosition: vi.fn(),
		typeIntoFocused: vi.fn(),
		close: vi.fn(),
	};
}

const NO_COMPUTER = untouchedComputer();

describe("#given withTargetedApp #when actions for two apps overlap #then each keeps its own target", () => {
	it("#when the first action is parked until the second has run #then neither sees the other's app, and neither leaves one behind", async () => {
		// given
		const firstParked = deferred();
		const releaseFirst = deferred();
		const seen: Array<readonly [string, number | undefined]> = [];

		// when
		const first = withTargetedApp(NO_COMPUTER, 42, async () => {
			seen.push(["first:before", currentInputScope()?.target?.pid]);
			firstParked.resolve();
			await releaseFirst.promise;
			seen.push(["first:after", currentInputScope()?.target?.pid]);
		});
		await firstParked.promise;
		await withTargetedApp(NO_COMPUTER, 77, async () => {
			seen.push(["second", currentInputScope()?.target?.pid]);
		});
		releaseFirst.resolve();
		await first;

		// then
		expect(seen).toEqual([
			["first:before", 42],
			["second", 77],
			["first:after", 42],
		]);
		expect(currentInputScope()).toBeUndefined();
		expect(NO_COMPUTER.setTarget).not.toHaveBeenCalled();
	});

	it("#when nested inside a dispatch bound to a window #then the same app keeps the window and stop check, another app does not get the window", async () => {
		// given
		const interruption = (): string | undefined => undefined;

		// when
		const seen = await runInInputScope({ target: { pid: 42, windowId: 12 }, interruption }, async () => ({
			same: await withTargetedApp(NO_COMPUTER, 42, async () => currentInputScope()),
			other: await withTargetedApp(NO_COMPUTER, 77, async () => currentInputScope()),
		}));

		// then
		expect(seen.same?.target).toEqual({ pid: 42, windowId: 12 });
		expect(seen.same?.interruption).toBe(interruption);
		expect(seen.other?.target).toEqual({ pid: 77 });
		expect(seen.other?.interruption).toBe(interruption);
	});

	it("#when given a pid that is not a positive integer #then it refuses before running the action", async () => {
		let ran = false;
		await expect(
			withTargetedApp(NO_COMPUTER, 0, async () => {
				ran = true;
			}),
		).rejects.toThrow("target pid must be a positive integer");
		expect(ran).toBe(false);
	});
});

describe("#given an input scope #when it is read inside the action #then it cannot be changed and says when to stop", () => {
	it("#when the action tries to retarget the scope #then the scope stays as it was opened", async () => {
		await runInInputScope({ target: { pid: 42, windowId: 12 } }, async () => {
			const scope = currentInputScope();
			expect(Object.isFrozen(scope)).toBe(true);
			expect(Object.isFrozen(scope?.target)).toBe(true);
		});
	});

	it("#when the interruption reports a reason #then assertInputMayContinue throws it as InputInterrupted", () => {
		expect(() => assertInputMayContinue({ interruption: () => undefined })).not.toThrow();
		expect(() => assertInputMayContinue(undefined)).not.toThrow();
		expect(() => assertInputMayContinue({ interruption: () => "the user stopped computer use" })).toThrow(
			new InputInterrupted("the user stopped computer use"),
		);
	});
});

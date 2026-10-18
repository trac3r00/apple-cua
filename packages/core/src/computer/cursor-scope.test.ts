import { describe, expect, it } from "vitest";

import { currentCursorIdentity, withCursorIdentity } from "./cursor-scope.js";

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

describe("#given cursor identity context #when callbacks run #then identity follows sync and async flow", () => {
	it("preserves synchronous return types and restores the enclosing identity", () => {
		const value = withCursorIdentity("outer", () => {
			expect(currentCursorIdentity()).toBe("outer");
			const nested = withCursorIdentity("inner", () => currentCursorIdentity());
			expect(currentCursorIdentity()).toBe("outer");
			return nested;
		});

		expect(value).toBe("inner");
		expect(currentCursorIdentity()).toBeUndefined();
	});

	it("keeps overlapping async callbacks isolated until each completes", async () => {
		const firstStarted = deferred();
		const resumeFirst = deferred();
		const first = withCursorIdentity("first", async () => {
			firstStarted.resolve();
			await resumeFirst.promise;
			return currentCursorIdentity();
		});
		await firstStarted.promise;

		const second = await withCursorIdentity("second", async () => {
			await Promise.resolve();
			return currentCursorIdentity();
		});
		resumeFirst.resolve();

		expect(await first).toBe("first");
		expect(second).toBe("second");
		expect(currentCursorIdentity()).toBeUndefined();
	});
});

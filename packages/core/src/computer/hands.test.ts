import { describe, expect, it } from "bun:test";
import { vi } from "@apple-cua/test-support";

import { HandsCoordinator } from "./hands.js";
import type { HandName, HandResource, HandTask, HandsPolicy } from "./hands.js";

function deferred<T>() {
	let settle: ((value: T | PromiseLike<T>) => void) | undefined;
	let fail: ((error: unknown) => void) | undefined;
	const promise = new Promise<T>((resolve, reject) => {
		settle = resolve;
		fail = reject;
	});
	return {
		promise,
		resolve(value: T): void {
			if (!settle) {
				throw new Error("Deferred was not initialized");
			}
			settle(value);
		},
		reject(error: unknown): void {
			if (!fail) {
				throw new Error("Deferred was not initialized");
			}
			fail(error);
		},
	};
}

function lane(hand: HandName, resources: readonly HandResource[]) {
	const started = deferred<void>();
	const finish = deferred<string>();
	const run = vi.fn(() => {
		started.resolve(undefined);
		return finish.promise;
	});
	const task: HandTask<string> = { hand, resources, run };
	return { task, started, finish, run };
}

describe("HandsCoordinator", () => {
	it("#given disjoint resources #when auto runs #then both start before either resolves", async () => {
		const left = lane("left", ["pointer"]);
		const right = lane("right", ["keyboard"]);
		let time = 5;
		const coordinator = new HandsCoordinator(() => time);

		const running = coordinator.run([left.task, right.task]);
		await Promise.all([left.started.promise, right.started.promise]);
		expect(left.run).toHaveBeenCalledOnce();
		expect(right.run).toHaveBeenCalledOnce();
		time = 15;
		left.finish.resolve("clicked");
		right.finish.resolve("typed");

		const result = await running;
		expect(result).toMatchObject({
			policy: "auto",
			aborted: false,
			notStarted: [],
			overlapMs: 10,
			sequentialEstimateMs: 20,
		});
		expect(result.lanes).toEqual([
			{
				index: 0,
				hand: "left",
				startedMs: 5,
				finishedMs: 15,
				waitMs: 0,
				durationMs: 10,
				ok: true,
				aborted: false,
				value: "clicked",
			},
			{
				index: 1,
				hand: "right",
				startedMs: 5,
				finishedMs: 15,
				waitMs: 0,
				durationMs: 10,
				ok: true,
				aborted: false,
				value: "typed",
			},
		]);
	});

	it("#given shared resources #when auto runs #then acquisition is atomic and waiters are FIFO", async () => {
		const first = lane("left", ["pointer"]);
		const second = lane("right", ["pointer", "keyboard"]);
		const third = lane("vision", ["keyboard"]);
		let time = 0;
		const running = new HandsCoordinator(() => time).run([first.task, second.task, third.task]);

		await first.started.promise;
		expect(second.run).not.toHaveBeenCalled();
		expect(third.run).not.toHaveBeenCalled();
		time = 4;
		first.finish.resolve("first");
		await second.started.promise;
		expect(third.run).not.toHaveBeenCalled();
		time = 9;
		second.finish.resolve("second");
		await third.started.promise;
		time = 12;
		third.finish.resolve("third");

		const result = await running;
		expect(result.lanes.map(({ waitMs, durationMs }) => ({ waitMs, durationMs }))).toEqual([
			{ waitMs: 0, durationMs: 4 },
			{ waitMs: 4, durationMs: 5 },
			{ waitMs: 9, durationMs: 3 },
		]);
		expect(result.overlapMs).toBe(0);
	});

	it("#given concurrent runs #when they share a coordinator #then resource ownership is shared", async () => {
		const first = lane("left", ["focus"]);
		const second = lane("right", ["focus"]);
		const coordinator = new HandsCoordinator();
		const firstRun = coordinator.run([first.task]);
		const secondRun = coordinator.run([second.task]);

		await first.started.promise;
		expect(second.run).not.toHaveBeenCalled();
		first.finish.resolve("first");
		await second.started.promise;
		second.finish.resolve("second");

		expect((await firstRun).lanes[0]?.value).toBe("first");
		expect((await secondRun).lanes[0]?.value).toBe("second");
	});

	it("#given disjoint resources #when policy is never #then tasks start sequentially in input order", async () => {
		const first = lane("left", ["pointer"]);
		const second = lane("right", ["keyboard"]);
		const running = new HandsCoordinator().run([first.task, second.task], { policy: "never" });

		await first.started.promise;
		expect(second.run).not.toHaveBeenCalled();
		first.finish.resolve("first");
		await second.started.promise;
		second.finish.resolve("second");

		expect((await running).lanes.map(({ value }) => value)).toEqual(["first", "second"]);
	});

	it("#given intersecting resources #when policy is always #then it rejects before starting anything", async () => {
		const first = lane("left", ["focus", "pointer"]);
		const second = lane("right", ["focus", "keyboard"]);

		await expect(new HandsCoordinator().run([first.task, second.task], { policy: "always" })).rejects.toThrow(
			'Hands policy "always" requires disjoint resources; conflict: focus',
		);
		expect(first.run).not.toHaveBeenCalled();
		expect(second.run).not.toHaveBeenCalled();
	});

	it("#given disjoint tasks #when policy is always #then all run functions are called immediately", async () => {
		const first = lane("left", ["pointer", "pointer"]);
		const second = lane("right", ["keyboard"]);

		const running = new HandsCoordinator().run([first.task, second.task], { policy: "always" });
		expect(first.run).toHaveBeenCalledOnce();
		expect(second.run).toHaveBeenCalledOnce();
		first.finish.resolve("first");
		second.finish.resolve("second");

		expect((await running).policy).toBe("always");
	});

	it.each<HandsPolicy>(["auto", "never", "always"])(
		"#given an already aborted signal #when policy is %s #then no tasks start",
		async (policy) => {
			const controller = new AbortController();
			controller.abort();
			const first = lane("left", ["pointer"]);
			const second = lane("right", ["keyboard"]);

			const result = await new HandsCoordinator().run([first.task, second.task], {
				policy,
				signal: controller.signal,
			});

			expect(result).toMatchObject({ aborted: true, lanes: [], notStarted: [0, 1], overlapMs: 0 });
			expect(first.run).not.toHaveBeenCalled();
			expect(second.run).not.toHaveBeenCalled();
		},
	);

	it("#given a running lane and waiters #when aborted #then running settles and pending tasks never start", async () => {
		const controller = new AbortController();
		const first = lane("left", ["pointer"]);
		const second = lane("right", ["pointer"]);
		const third = lane("vision", ["pointer"]);
		const running = new HandsCoordinator().run([first.task, second.task, third.task], {
			signal: controller.signal,
		});
		const settled = vi.fn();
		const observed = running.then(settled);

		await first.started.promise;
		controller.abort();
		expect(settled).not.toHaveBeenCalled();
		first.finish.resolve("finished");
		const result = await running;
		await observed;

		expect(result).toMatchObject({
			aborted: true,
			notStarted: [1, 2],
			lanes: [{ ok: true, value: "finished" }],
		});
		expect(second.run).not.toHaveBeenCalled();
		expect(third.run).not.toHaveBeenCalled();
	});

	it.each<HandsPolicy>(["auto", "never", "always"])(
		"#given a synchronous abort during task start #when policy is %s #then later tasks never start",
		async (policy) => {
			const controller = new AbortController();
			const second = lane("right", ["keyboard"]);
			const first: HandTask<string> = {
				hand: "left",
				resources: ["pointer"],
				run: () => {
					controller.abort();
					return Promise.resolve("first");
				},
			};

			const result = await new HandsCoordinator().run([first, second.task], {
				policy,
				signal: controller.signal,
			});

			expect(result).toMatchObject({ aborted: true, notStarted: [1], lanes: [{ value: "first", ok: true }] });
			expect(second.run).not.toHaveBeenCalled();
		},
	);

	it("#given an aborted queued run #when another run waits #then cancelled waiters do not block progress", async () => {
		const coordinator = new HandsCoordinator();
		const controller = new AbortController();
		const first = lane("left", ["pointer"]);
		const cancelled = lane("right", ["pointer"]);
		const last = lane("vision", ["capture"]);
		const firstRun = coordinator.run([first.task]);
		const cancelledRun = coordinator.run([cancelled.task], { signal: controller.signal });
		const lastRun = coordinator.run([last.task]);

		await first.started.promise;
		controller.abort();
		await last.started.promise;
		last.finish.resolve("captured");
		first.finish.resolve("clicked");

		expect((await cancelledRun).notStarted).toEqual([0]);
		expect(cancelled.run).not.toHaveBeenCalled();
		await Promise.all([firstRun, lastRun]);
	});

	it("#given a lane failure #when siblings run and wait #then failure is isolated and resources release", async () => {
		const first = lane("left", ["pointer"]);
		const second = lane("right", ["keyboard"]);
		const third = lane("vision", ["pointer"]);
		const error = new Error("click failed");
		const running = new HandsCoordinator().run([first.task, second.task, third.task]);

		await Promise.all([first.started.promise, second.started.promise]);
		first.finish.reject(error);
		await third.started.promise;
		third.finish.resolve("retried");
		second.finish.resolve("typed");

		const result = await running;
		expect(result.aborted).toBe(false);
		expect(result.lanes).toMatchObject([
			{ ok: false, aborted: false, error },
			{ ok: true, value: "typed" },
			{ ok: true, value: "retried" },
		]);
	});

	it("#given a thrown AbortError #when a lane aborts #then it is classified as abort and stops waiters", async () => {
		const first = lane("left", ["pointer"]);
		const sibling = lane("vision", ["capture"]);
		const pending = lane("right", ["pointer"]);
		const error = new Error("stopped");
		error.name = "AbortError";
		const running = new HandsCoordinator().run([first.task, sibling.task, pending.task]);

		await Promise.all([first.started.promise, sibling.started.promise]);
		first.finish.reject(error);
		sibling.finish.resolve("captured");

		expect(await running).toMatchObject({
			aborted: true,
			notStarted: [2],
			lanes: [
				{ ok: false, aborted: true, error },
				{ ok: true, aborted: false, value: "captured" },
			],
		});
	});

	it("#given three overlapping intervals #when measured #then triple overlap counts only once", async () => {
		// Intervals: left [0, 10], right [2, 8], vision [4, 12].
		const times = [0, 0, 2, 4, 8, 10, 12];
		const coordinator = new HandsCoordinator(() => {
			const time = times.shift();
			if (time === undefined) {
				throw new Error("Unexpected clock read");
			}
			return time;
		});
		const left = lane("left", ["pointer"]);
		const right = lane("right", ["keyboard"]);
		const vision = lane("vision", ["capture", "ax"]);
		const running = coordinator.run([left.task, right.task, vision.task], { policy: "always" });

		right.finish.resolve("typed");
		left.finish.resolve("clicked");
		vision.finish.resolve("observed");

		const result = await running;
		expect(result.overlapMs).toBe(8);
		expect(result.sequentialEstimateMs).toBe(24);
		expect(result.lanes.map(({ durationMs }) => durationMs)).toEqual([10, 6, 8]);
		expect(times).toEqual([]);
	});

	it("#given no tasks #when run #then it returns empty results and zero measurements", async () => {
		expect(await new HandsCoordinator().run([])).toEqual({
			policy: "auto",
			aborted: false,
			lanes: [],
			notStarted: [],
			overlapMs: 0,
			sequentialEstimateMs: 0,
		});
	});
});

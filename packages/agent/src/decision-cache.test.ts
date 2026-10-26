import { describe, expect, it, vi } from "vitest";
import type { PrefetchStatus } from "./decision-cache.js";
import { createDecider } from "./decision.js";
import type { DecisionFrame, DecisionRequest } from "./decision.js";

const request: DecisionRequest = {
	goal: "Wait for the window",
	history: [],
	space: {
		platform: "macos",
		app: "Finder",
		elements: [],
		visibleText: [],
		targets: {},
		operations: ["WAIT", "BLOCKED"],
		truncated: false,
		pruned: 0,
		sparse: false,
	},
};

function response(operation = "WAIT"): Response {
	return new Response(
		JSON.stringify({
			choices: [
				{ message: { content: JSON.stringify({ answers: { operation: { choice: operation, confidence: 1 } } }) } },
			],
		}),
	);
}

function deferred<T>() {
	let resolve: (value: T) => void = () => {
		throw new Error("deferred promise has not initialized");
	};
	const promise = new Promise<T>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

function fixture() {
	let now = 0;
	let frame: DecisionFrame | undefined = { hash: "frame-a", image: "aW1hZ2U=", surface: "1234:71" };
	const events: PrefetchStatus[] = [];
	const fetchImpl = vi.fn<typeof fetch>(async () => response());
	const decide = createDecider({
		endpoint: "https://decision.invalid",
		model: "test",
		fetchImpl,
		now: () => now,
		latestFrame: () => frame,
		onPrefetch: (status) => events.push(status),
	});
	return {
		decide,
		fetchImpl,
		events,
		setTime: (value: number) => {
			now = value;
		},
		setFrame: (value: DecisionFrame | undefined) => {
			frame = value;
		},
	};
}

describe("frame decision cache", () => {
	it("#given cached answers #when the frame and questions match #then a marked hit makes zero gateway calls", async () => {
		const f = fixture();
		await f.decide(request);
		f.fetchImpl.mockClear();

		const result = await f.decide(request);

		expect(result).toMatchObject({ ok: true, decision: { operation: "WAIT", cache: "hit", frameHash: "frame-a" } });
		expect(f.fetchImpl).not.toHaveBeenCalled();
	});

	it("#given cached answers #when the frame hash changes #then one gateway call supplies fresh answers", async () => {
		const f = fixture();
		await f.decide(request);
		f.fetchImpl.mockClear();
		f.setFrame({ hash: "frame-b", image: "bmV3", surface: "1234:71" });

		const result = await f.decide(request);

		expect(f.fetchImpl).toHaveBeenCalledTimes(1);
		expect(result).toMatchObject({ ok: true, decision: { frameHash: "frame-b" } });
		expect(result.ok && result.decision.cache).toBeUndefined();
	});

	it("#given cached answers #when their TTL reaches 2000ms #then one gateway call replaces them", async () => {
		const f = fixture();
		await f.decide(request);
		f.fetchImpl.mockClear();
		f.setTime(2_000);

		const result = await f.decide(request);

		expect(f.fetchImpl).toHaveBeenCalledTimes(1);
		expect(result.ok && result.decision.cache).toBeUndefined();
	});

	it("#given cached answers #when questions change #then the gateway is called instead of reusing answers", async () => {
		const f = fixture();
		await f.decide(request);
		f.fetchImpl.mockClear();

		await f.decide({ ...request, space: { ...request.space, operations: ["BLOCKED"] } });

		expect(f.fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("#given cached answers #when the goal changes #then the gateway is called for the new goal", async () => {
		const f = fixture();
		await f.decide(request);
		f.fetchImpl.mockClear();

		await f.decide({ ...request, goal: "A different goal" });

		expect(f.fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("#given identical pixels #when the surface changes #then another window cannot reuse the answers", async () => {
		const f = fixture();
		await f.decide(request);
		f.fetchImpl.mockClear();
		f.setFrame({ hash: "frame-a", image: "aW1hZ2U=", surface: "1234:72" });

		await f.decide(request);

		expect(f.fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("#given a prefetch #when its frame stays current #then parked answers serve the next decision without fetching", async () => {
		const f = fixture();

		await f.decide.prefetch?.(request);
		expect(f.fetchImpl).toHaveBeenCalledTimes(1);
		f.fetchImpl.mockClear();
		const result = await f.decide(request);

		expect(f.events).toEqual(["parked"]);
		expect(result).toMatchObject({ ok: true, decision: { cache: "hit" } });
		expect(f.fetchImpl).not.toHaveBeenCalled();
	});

	it("#given an in flight prefetch #when its frame changes #then stale answers are discarded and never used", async () => {
		const f = fixture();
		const started = deferred<void>();
		const gateway = deferred<Response>();
		f.fetchImpl.mockImplementationOnce(() => {
			started.resolve();
			return gateway.promise;
		});
		const pending = f.decide.prefetch?.(request);
		await started.promise;

		f.setFrame({ hash: "frame-b", image: "bmV3", surface: "1234:71" });
		gateway.resolve(response("WAIT"));
		await pending;
		f.fetchImpl.mockClear();
		f.fetchImpl.mockResolvedValueOnce(response("BLOCKED"));
		const result = await f.decide(request);

		expect(f.events).toEqual(["discarded"]);
		expect(f.fetchImpl).toHaveBeenCalledTimes(1);
		expect(result).toMatchObject({ ok: true, decision: { operation: "BLOCKED", frameHash: "frame-b" } });
		expect(result.ok && result.decision.cache).toBeUndefined();
	});

	it("#given a speculative gateway failure #when prefetch completes #then the error is swallowed and a normal request works", async () => {
		const f = fixture();
		f.fetchImpl.mockRejectedValueOnce(new Error("gateway unavailable"));

		await expect(f.decide.prefetch?.(request)).resolves.toBeUndefined();
		f.fetchImpl.mockClear();
		const result = await f.decide(request);

		expect(f.events).toEqual(["error"]);
		expect(f.fetchImpl).toHaveBeenCalledTimes(1);
		expect(result).toMatchObject({ ok: true, decision: { operation: "WAIT" } });
	});

	it("#given a pending prefetch #when another prefetch is requested #then only one gateway request is in flight", async () => {
		const f = fixture();
		const started = deferred<void>();
		const gateway = deferred<Response>();
		f.fetchImpl.mockImplementation(() => {
			started.resolve();
			return gateway.promise;
		});
		const pending = f.decide.prefetch?.(request);
		await started.promise;

		const duplicate = f.decide.prefetch?.(request);
		gateway.resolve(response());
		await Promise.all([pending, duplicate]);

		expect(f.fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("#given a foreground request #when its frame changes before completion #then no stale decision is returned", async () => {
		const f = fixture();
		const gateway = deferred<Response>();
		f.fetchImpl.mockImplementationOnce(() => gateway.promise);
		const pending = f.decide(request);

		f.setFrame({ hash: "frame-b", image: "bmV3", surface: "1234:71" });
		gateway.resolve(response());

		await expect(pending).resolves.toMatchObject({ ok: false, refusal: { reason: "stale-frame" } });
	});

	it("#given cached answers #when the hot frame becomes unavailable #then the cache is bypassed", async () => {
		const f = fixture();
		await f.decide(request);
		f.fetchImpl.mockClear();
		f.setFrame(undefined);

		const result = await f.decide(request);

		expect(f.fetchImpl).toHaveBeenCalledTimes(1);
		expect(result.ok && result.decision.cache).toBeUndefined();
	});
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarness, jsonPayload, observe } from "./protocol-client-harness.js";
import { Deferred } from "./protocol-test-harness.js";

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	vi.useRealTimers();
	await closeHarness?.();
	closeHarness = undefined;
});

describe("tool timing #given a client progress token #when a handler is held #then the server sends a heartbeat", () => {
	it("emits progress before the result and still returns the measured total", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		await observe(harness);
		const release = new Deferred<void>();
		harness.computer.stateGate = release;
		const progress: number[] = [];
		vi.useFakeTimers();

		const pending = harness.client.callTool(
			{ name: "get_app_state", arguments: { app: "Finder", include_screenshot: false } },
			undefined,
			{ onprogress: (notification) => progress.push(notification.progress) },
		);
		await vi.advanceTimersByTimeAsync(1_000);
		expect(progress.length).toBeGreaterThan(0);
		release.resolve(undefined);
		const payload = jsonPayload(await pending);

		expect(payload["timing_ms"]).toMatchObject({ total: expect.any(Number), handler: expect.any(Number) });
	});
});

import { describe, expect, it } from "vitest";
import { type HeartbeatTimer, TimingHeartbeat, ToolUsageRegistry, mergeTiming } from "./tool-timing.js";

describe("#given a tool usage registry #when samples exceed its bounded ring #then counters remain exact", () => {
	it("retains exact calls, errors, and bytes after eviction", () => {
		const registry = new ToolUsageRegistry(() => 123);
		for (let index = 0; index < 600; index++) registry.record("capture", index, index % 3 === 0, 2);

		expect(registry.snapshot()).toMatchObject({
			since: 123,
			calls: 600,
			errors: 200,
			total_bytes: 1200,
			by_tool: { capture: { calls: 600, errors: 200, bytes: 1200 } },
		});
	});
});

describe("#given recorded latencies #when snapshotting #then quantiles use nearest rank", () => {
	it("reports p50 and p95 from sorted samples", () => {
		const registry = new ToolUsageRegistry();
		for (let duration = 1; duration <= 20; duration++) registry.record("read", duration, false, 0);

		expect(registry.snapshot()).toMatchObject({ p50_ms: 10, p95_ms: 19 });
	});
});

describe("#given JSON tool output #when timing is merged #then existing capture timing remains", () => {
	it("merges timing into the final JSON object", () => {
		const result = mergeTiming(
			{ content: [{ type: "text", text: '{"ok":true,"timing_ms":{"capture":12}}' }] },
			{ total: 20, handler: 8 },
		);

		expect(JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "{}")).toEqual({
			ok: true,
			timing_ms: { capture: 12, total: 20, handler: 8 },
		});
	});
});

describe("#given text and image content #when timing is merged #then content is preserved", () => {
	it("prepends timing so the original final text item stays the payload", () => {
		const result = mergeTiming(
			{
				content: [
					{ type: "text", text: "plain response" },
					{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
				],
			},
			{ total: 9 },
		);

		expect(result.content).toEqual([
			{ type: "text", text: '{"timing_ms":{"total":9}}' },
			{ type: "text", text: "plain response" },
			{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
		]);
	});

	it("keeps a JSON array payload last instead of replacing it with timing", () => {
		const result = mergeTiming({ content: [{ type: "text", text: '[{"worker_id":"w1"}]' }] }, { total: 4 });

		expect(result.content).toEqual([
			{ type: "text", text: '{"timing_ms":{"total":4}}' },
			{ type: "text", text: '[{"worker_id":"w1"}]' },
		]);
	});
});

describe("#given an error result #when timing is merged #then the error flag is preserved", () => {
	it("keeps isError true", () => {
		expect(mergeTiming({ content: [], isError: true }, { total: 1 }).isError).toBe(true);
	});
});

describe("#given a progress token #when a heartbeat runs #then progress increases without overlap and stops once", () => {
	it("sends increasing progress and cancels exactly once", async () => {
		let now = 0;
		let callback: (() => void) | undefined;
		let clears = 0;
		let active = false;
		const sent: number[] = [];
		let releaseFirst: (() => void) | undefined;
		const heartbeat = new TimingHeartbeat({
			progressToken: "token",
			send: (notification) => {
				expect(notification.method).toBe("notifications/progress");
				expect(notification.params.progressToken).toBe("token");
				if (active) throw new Error("overlapping heartbeat send");
				active = true;
				sent.push(notification.params.progress);
				if (sent.length === 1) {
					return new Promise<void>((resolve) => {
						releaseFirst = () => {
							active = false;
							resolve();
						};
					});
				}
				active = false;
				return undefined;
			},
			now: () => now,
			schedule: (fn, _delayMs): HeartbeatTimer => {
				callback = fn;
				return {};
			},
			cancel: (_timer) => {
				clears++;
			},
		});

		heartbeat.start();
		now = 1000;
		callback?.();
		callback?.();
		releaseFirst?.();
		await Promise.resolve();
		now = 2000;
		callback?.();
		await Promise.resolve();
		heartbeat.stop();
		heartbeat.stop();
		callback?.();

		expect(sent).toEqual([1, 2]);
		expect(clears).toBe(1);
	});

	it("does not schedule without a progress token", () => {
		let schedules = 0;
		const heartbeat = new TimingHeartbeat({
			progressToken: undefined,
			send: () => undefined,
			schedule: () => {
				schedules++;
				return {};
			},
		});

		heartbeat.start();

		expect(schedules).toBe(0);
	});
});

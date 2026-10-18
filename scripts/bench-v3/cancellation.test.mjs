import assert from "node:assert/strict";
import { test } from "node:test";
import {
	cancellationAcceptance,
	cancellationFixtureRoot,
	cleanupFixture,
	dispatchCancelledCall,
	hostTimestampNs,
	relativeEvents,
	settleResponse,
} from "./cancellation-run.mjs";

test("#given an offscreen owned window #when closure fails #then cleanup refuses success and retains its file", async () => {
	const { mkdtempSync, writeFileSync, existsSync, rmSync } = await import("node:fs");
	const directory = mkdtempSync("/tmp/cancellation-cleanup-");
	const file = `${directory}/cancellation.txt`;
	writeFileSync(file, "owned control");
	const probe = {
		snapshot: () => ({
			windows: [{ owner: "TextEdit", title: "cancellation.txt", pid: 123, onScreen: false }],
		}),
	};
	try {
		await assert.rejects(
			cleanupFixture(probe, () => undefined, file, "cancellation.txt", Promise.resolve()),
			/window remains/,
		);
		assert.equal(existsSync(file), true);
	} finally {
		rmSync(directory, { recursive: true });
	}
});

test("#given an asynchronous close event #when cleaning up #then readback waits and ignores unrelated app windows", async () => {
	const { mkdtempSync, writeFileSync, existsSync, rmSync } = await import("node:fs");
	const directory = mkdtempSync("/tmp/cancellation-cleanup-");
	const file = `${directory}/cancellation.txt`;
	writeFileSync(file, "owned control");
	let resolveClosed;
	const closedEvent = new Promise((resolve) => {
		resolveClosed = resolve;
	});
	let signaled = false;
	const probe = {
		snapshot: () => {
			assert.equal(signaled, true);
			return { windows: [{ owner: "OtherApp", title: "cancellation.txt", onScreen: true }] };
		},
	};
	try {
		const result = await cleanupFixture(
			probe,
			() => {
				queueMicrotask(() => {
					signaled = true;
					resolveClosed();
				});
			},
			file,
			"cancellation.txt",
			closedEvent,
		);
		assert.equal(result.target_file_removed, true);
		assert.equal(existsSync(file), false);
	} finally {
		rmSync(directory, { recursive: true });
	}
});

test("#given large wire responses #when recording cancellation evidence #then payload and error stay complete", async () => {
	const payload = { content: [{ type: "text", text: "x".repeat(6000) }] };
	assert.deepEqual((await settleResponse(Promise.resolve(payload))).value, payload);
	const error = new Error(JSON.stringify({ code: -32800, message: "x".repeat(6000) }));
	const recorded = await settleResponse(Promise.reject(error));
	assert.equal(recorded.error, String(error));
	assert.equal(cancellationAcceptance(recorded), "accepted");
});

test("#given the macOS temporary directory alias #when resolving the owned root #then the physical path is accepted", async () => {
	const { mkdtempSync, mkdirSync, symlinkSync, realpathSync, rmSync } = await import("node:fs");
	const directory = mkdtempSync("/tmp/cancellation-root-");
	try {
		mkdirSync(`${directory}/physical`);
		mkdirSync(`${directory}/physical/cua-bench`);
		symlinkSync(`${directory}/physical`, `${directory}/alias`);
		assert.equal(
			cancellationFixtureRoot(`${directory}/alias/cua-bench`),
			realpathSync(`${directory}/physical/cua-bench`),
		);
	} finally {
		rmSync(directory, { recursive: true });
	}
});

test("#given a millisecond wall clock #when converting to host time #then it uses Unix epoch nanoseconds", () => {
	assert.equal(hostTimestampNs(1_800_000_000_123), "1800000000123000000");
});

test("#given an in-flight mutation #when dispatching cancellation #then it uses that exact request id", () => {
	const writes = [];
	const client = {
		nextId: 17,
		child: { stdin: { write: (line) => writes.push(JSON.parse(line)) } },
		request(method, params) {
			const id = this.nextId++;
			assert.equal(method, "tools/call");
			assert.equal(params.name, "type_text");
			return Promise.resolve({ id, result: "completed" });
		},
	};

	const dispatched = dispatchCancelledCall(client, () => client.request("tools/call", { name: "type_text" }));

	assert.equal(dispatched.requestId, 17);
	assert.equal(writes[0].method, "notifications/cancelled");
	assert.equal(writes[0].params.requestId, 17);
	assert.equal(typeof dispatched.notificationAtHostNs, "string");
});

test("#given a fast response #when judging cancellation #then it is not evidence of acceptance", async () => {
	const fast = await Promise.resolve({ kind: "response", value: { content: [] } });
	assert.equal(cancellationAcceptance(fast), "unknown");
	assert.equal(
		cancellationAcceptance({ kind: "error", error: 'Error: {"code":-32800,"message":"Cancelled"}' }),
		"accepted",
	);
	assert.equal(cancellationAcceptance({ kind: "error", error: "timeout: tools/call" }), "unknown");
});

test("#given timestamped input events #when relating them to cancellation #then signed nanosecond offsets are preserved", () => {
	const events = [
		{ kind: "cg-input", host_time_ns: "1000000200" },
		{ kind: "ax-value-changed", host_time_ns: "999999800" },
	];
	assert.deepEqual(relativeEvents(events, "1000000000"), [
		{ ...events[0], relative_to_cancel_ns: "200" },
		{ ...events[1], relative_to_cancel_ns: "-200" },
	]);
	assert.deepEqual(events[0], { kind: "cg-input", host_time_ns: "1000000200" });
});

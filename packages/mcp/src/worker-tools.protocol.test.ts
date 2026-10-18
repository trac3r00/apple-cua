import { describe, expect, it } from "vitest";
import { createHarness, jsonText } from "./protocol-client-harness.js";

type Worker = {
	readonly worker_id: string;
	readonly observation_token: string;
	readonly cursor_id?: string;
};

describe("registered worker tools #given malformed steps #when submitted #then strict validation precedes every dispatch", () => {
	it("rejects incomplete assignment and release operations without changing ownership", async () => {
		const harness = await createHarness();
		try {
			for (const arguments_ of [{ op: "assign" }, { op: "release" }, { op: "observe" }]) {
				const result = await harness.client.callTool({ name: "manage_workers", arguments: arguments_ });
				expect(result.isError).toBe(true);
			}
			const status = await harness.client.callTool({ name: "manage_workers", arguments: { op: "status" } });
			expect(JSON.parse(jsonText(status))).toEqual([]);
			expect(harness.computer.effects).toEqual([]);
		} finally {
			await harness.close();
		}
	});

	it("rejects the whole batch without consuming the worker token", async () => {
		const harness = await createHarness();
		try {
			const assigned = await harness.client.callTool({
				name: "manage_workers",
				arguments: { op: "assign", assignments: [{ worker_id: "one", task: "edit note", app: "Finder" }] },
			});
			const [worker] = workerList(JSON.parse(jsonText(assigned)));
			if (worker === undefined) throw new Error("missing worker");

			const invalid = await harness.client.callTool({
				name: "run_worker",
				arguments: {
					worker_id: worker.worker_id,
					observation_token: worker.observation_token,
					steps: [{ type: "set_value", element_index: "20", value: "never" }, null],
				},
			});

			expect(invalid.isError).toBe(true);
			expect(harness.computer.effects).toEqual([]);
			const valid = await harness.client.callTool({
				name: "run_worker",
				arguments: {
					worker_id: worker.worker_id,
					observation_token: worker.observation_token,
					steps: [{ type: "set_value", element_index: "20", value: "verified" }],
					expect: { checks: [{ element_index: "20", value: "verified" }] },
				},
			});
			expect(valid.isError).not.toBe(true);
			expect(objectValue(JSON.parse(jsonText(valid)))["verification"]).toMatchObject({ verified: true });
		} finally {
			await harness.close();
		}
	});
});

function objectValue(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("expected an object result");
	}
	return Object.fromEntries(Object.entries(value));
}

function workerList(value: unknown): readonly Worker[] {
	if (!Array.isArray(value)) {
		throw new Error("expected a worker list");
	}
	return value.map((item) => {
		const worker = objectValue(item);
		const workerId = worker["worker_id"];
		const token = worker["observation_token"];
		const cursor = worker["cursor_id"];
		if (typeof workerId !== "string" || typeof token !== "string") {
			throw new Error("worker result is missing its identity or token");
		}
		return {
			worker_id: workerId,
			observation_token: token,
			...(typeof cursor === "string" ? { cursor_id: cursor } : {}),
		};
	});
}

function imageBlocks(value: unknown): readonly Record<string, unknown>[] {
	if (typeof value !== "object" || value === null || !("content" in value) || !Array.isArray(value.content)) {
		throw new Error("expected MCP content blocks");
	}
	return value.content.flatMap((item: unknown) => {
		if (typeof item !== "object" || item === null || !("type" in item) || item.type !== "image") {
			return [];
		}
		return [objectValue(item)];
	});
}

describe("registered worker tools #given two app assignments #when workers execute and verify #then ownership remains isolated", () => {
	it("assigns, executes, verifies, and releases both workers", async () => {
		const harness = await createHarness(undefined, undefined, undefined, {
			serverOptions: { toolset: "full", iphone: false },
		});
		try {
			const assignedResult = await harness.client.callTool({
				name: "manage_workers",
				arguments: {
					op: "assign",
					assignments: [
						{ worker_id: "one", task: "edit first", app: "Finder" },
						{ worker_id: "two", task: "edit second", app: "Other" },
					],
				},
			});
			const assignedText = jsonText(assignedResult);
			const assignedPayload: unknown = JSON.parse(assignedText);
			const assignedEntries = Array.isArray(assignedPayload) ? assignedPayload.map(objectValue) : [];
			expect(assignedEntries).toHaveLength(2);
			expect(assignedEntries.map((entry) => entry["images"])).toEqual([[0], [1]]);
			expect(assignedEntries.every((entry) => entry["observation_token"] !== undefined)).toBe(true);
			expect(assignedEntries.every((entry) => entry["observation"] === undefined)).toBe(true);
			expect(assignedText).not.toContain(Buffer.from("png-bytes").toString("base64"));
			expect(imageBlocks(assignedResult)).toHaveLength(2);
			const decoded = workerList(assignedPayload);
			expect(new Set(decoded.map((worker) => worker.cursor_id)).size).toBe(2);

			const first = decoded[0];
			const second = decoded[1];
			if (first === undefined || second === undefined) {
				throw new Error("two assignments were not returned");
			}

			const observed = await harness.client.callTool({
				name: "manage_workers",
				arguments: { op: "observe", worker_id: first.worker_id, include_screenshot: true, max_elements: 8 },
			});
			const observedPayload = objectValue(JSON.parse(jsonText(observed)));
			expect(observedPayload["worker_id"]).toBe(first.worker_id);
			expect(observedPayload["images"]).toEqual([0]);
			expect(imageBlocks(observed)).toHaveLength(1);
			expect(imageBlocks(observed)[0]).toMatchObject({
				type: "image",
				data: Buffer.from("png-bytes").toString("base64"),
			});

			const refreshedWithoutImage = await harness.client.callTool({
				name: "manage_workers",
				arguments: { op: "observe", worker_id: first.worker_id, include_screenshot: false, max_elements: 4 },
			});
			const freshPayload = objectValue(JSON.parse(jsonText(refreshedWithoutImage)));
			expect(freshPayload["observation_token"]).not.toBe(observedPayload["observation_token"]);
			expect(freshPayload["images"]).toBeUndefined();
			expect(imageBlocks(refreshedWithoutImage)).toHaveLength(0);
			expect(harness.computer.stateOptions.at(-1)).toMatchObject({
				includeAccessibilityTree: true,
				includeScreenshot: false,
				maxElements: 4,
			});

			for (const worker of [first, second]) {
				const freshToken = freshPayload["observation_token"];
				if (typeof freshToken !== "string") {
					throw new Error("worker observation did not return a token");
				}
				const workerToken = worker.worker_id === first.worker_id ? freshToken : worker.observation_token;
				const run = await harness.client.callTool({
					name: "run_worker",
					arguments: {
						worker_id: worker.worker_id,
						observation_token: workerToken,
						steps: [{ type: "set_value", element_index: "20", value: worker.worker_id }],
						expect: { checks: [{ element_index: "20", value: worker.worker_id }] },
						include_screenshot: true,
					},
				});
				expect(run.isError).not.toBe(true);
				const runPayload = objectValue(JSON.parse(jsonText(run)));
				expect(runPayload["worker_id"]).toBe(worker.worker_id);
				expect(runPayload["app"]).toBeDefined();
				expect(runPayload["images"]).toEqual([0]);
				expect(imageBlocks(run)).toHaveLength(1);
				const statusResult = await harness.client.callTool({
					name: "manage_workers",
					arguments: { op: "status" },
				});
				expect(jsonText(statusResult)).toContain(worker.worker_id);
			}

			const foreign = await harness.client.callTool({
				name: "run_worker",
				arguments: {
					worker_id: first.worker_id,
					observation_token: second.observation_token,
					steps: [{ type: "type_text", text: "must not dispatch" }],
				},
			});
			expect(foreign.isError).toBe(true);
			expect(harness.computer.effects.filter((effect) => effect.kind === "type")).toEqual([]);

			const refusalObservation = await harness.client.callTool({
				name: "manage_workers",
				arguments: { op: "observe", worker_id: first.worker_id, include_screenshot: false },
			});
			const refusalPayload = objectValue(JSON.parse(jsonText(refusalObservation)));
			const refusalToken = refusalPayload["observation_token"];
			if (typeof refusalToken !== "string") {
				throw new Error("worker observation did not return a token");
			}
			harness.computer.preflightResult = { ok: false, reason: "window-missing" };
			const refused = await harness.client.callTool({
				name: "run_worker",
				arguments: {
					worker_id: first.worker_id,
					observation_token: refusalToken,
					steps: [{ type: "type_text", text: "must not dispatch" }],
				},
			});
			expect(refused.isError).toBe(true);
			expect(objectValue(JSON.parse(jsonText(refused)))).toMatchObject({
				worker_id: first.worker_id,
				actionDispatched: false,
				effect: "refused",
				reason: "window-missing",
			});
			expect(imageBlocks(refused)).toHaveLength(0);

			const conflict = await harness.client.callTool({
				name: "manage_workers",
				arguments: {
					op: "assign",
					assignments: [{ worker_id: "three", task: "conflict", app: "1234" }],
				},
			});
			expect(conflict.isError).toBe(true);

			for (const worker of decoded) {
				const released = await harness.client.callTool({
					name: "manage_workers",
					arguments: { op: "release", worker_id: worker.worker_id },
				});
				expect(released.isError).not.toBe(true);
			}
		} finally {
			await harness.close();
		}
	});
});

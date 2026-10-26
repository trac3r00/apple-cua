import type { Server } from "node:http";
import { createServer } from "node:http";
import type { HotFrameWorker } from "@apple-cua/core";
import { HotFrameSource } from "@apple-cua/core";
import * as core from "@apple-cua/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { latestDecisionFrame } from "./decision-frame.js";
import { createHarness, jsonPayload } from "./protocol-client-harness.js";
import { FakeGuardedComputer } from "./protocol-test-harness.js";

let closeHarness: (() => Promise<void>) | undefined;
let mockServer: Server | undefined;

beforeEach(() => {
	vi.spyOn(core, "captureWindowViaSck").mockReturnValue(Buffer.from("small-decision-jpeg"));
});

afterEach(async () => {
	await closeHarness?.();
	closeHarness = undefined;
	mockServer?.close();
	mockServer = undefined;
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

function startDecisionMock(responses: unknown[], onBody?: (body: string) => void): Promise<{ readonly port: number }> {
	const server = createServer((request, response) => {
		let body = "";
		request.on("data", (chunk) => {
			body += chunk;
		});
		request.on("end", () => {
			onBody?.(body);
			const next = responses.shift();
			if (next === undefined) {
				response.statusCode = 500;
				response.end(JSON.stringify({ error: "no queued answer" }));
				return;
			}
			response.setHeader("content-type", "application/json");
			response.end(
				JSON.stringify({
					choices: [{ message: { role: "assistant", content: JSON.stringify(next) } }],
				}),
			);
		});
	});
	mockServer = server;
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (address === null || typeof address === "string") {
				reject(new Error("mock decision endpoint did not bind"));
				return;
			}
			resolve({ port: address.port });
		});
	});
}

function decisionAnswer(answers: Record<string, unknown>): unknown {
	return { answers };
}

function decisionFrames() {
	let deliver: (message: unknown) => void = () => undefined;
	const worker: HotFrameWorker = {
		on: (event, callback) => {
			if (event === "message") {
				deliver = callback;
			}
		},
		postMessage: () => undefined,
		terminate: async () => undefined,
	};
	const hotFrames = new HotFrameSource({ spawnWorker: () => worker, maxAgeMs: 60_000 });
	hotFrames.start(1234, 71, { width: 1000, height: 800 });
	const frame = (hash: string, data = Buffer.alloc(80_000, 1)) => {
		deliver({ type: "frame", hash, bytes: new Uint8Array(data), width: 1000, height: 800 });
	};
	frame("frame-a");
	return { hotFrames, frame };
}

describe("hot frame decision wiring", () => {
	it("#given an oversized hot frame #when deciding #then only the bounded fresh image reaches the endpoint", async () => {
		const images: string[] = [];
		const mock = await startDecisionMock(
			[decisionAnswer({ operation: { choice: "PRESS", confidence: 1 }, press_target: { choice: "9" } })],
			(body) => {
				const chat: { messages: { content: string }[] } = JSON.parse(body);
				for (const message of chat.messages) {
					const request: { state: { image: string } } = JSON.parse(message.content);
					images.push(request.state.image);
				}
			},
		);
		vi.stubEnv("APPLE_CUA_DECISION_ENDPOINT", `http://127.0.0.1:${mock.port}/v1/chat/completions`);
		vi.stubEnv("LLM_POOL_PROXY_API_KEY", "test-key");
		const frames = decisionFrames();
		const computer = new FakeGuardedComputer();
		const harness = await createHarness(computer, undefined, undefined, {
			serverOptions: { hotFramesSource: frames.hotFrames },
		});
		closeHarness = harness.close;
		await harness.client.callTool({
			name: "run_decision",
			arguments: { app: "Finder", goal: "Open the thing", max_steps: 1 },
		});
		expect(images).toHaveLength(1);
		const image = Buffer.from(images[0] ?? "", "base64");
		expect(image.byteLength).toBeLessThanOrEqual(20_000);
		expect(image).toEqual(Buffer.from("small-decision-jpeg"));
		expect(image).not.toEqual(Buffer.alloc(80_000, 1));
	});

	it("#given changing capture bytes #when the hot frame is unchanged #then its hash remains the identity", async () => {
		const frames = decisionFrames();
		try {
			const capture = vi.mocked(core.captureWindowViaSck);
			capture.mockReturnValueOnce(Buffer.alloc(20_000, 2)).mockReturnValueOnce(Buffer.alloc(10_000, 3));
			const surface = { pid: 1234, windowId: 71 };
			const first = latestDecisionFrame(frames.hotFrames, surface);
			const second = latestDecisionFrame(frames.hotFrames, surface);
			expect(first?.hash).toBe("frame-a");
			expect(second?.hash).toBe(first?.hash);
			expect(first?.image).not.toBe(second?.image);
			expect(Buffer.from(first?.image ?? "", "base64").byteLength).toBe(20_000);
			frames.frame("frame-b");
			expect(latestDecisionFrame(frames.hotFrames, surface)?.hash).toBe("frame-b");
		} finally {
			await frames.hotFrames.dispose();
		}
	});

	it.each([20_000, 20_001, null])(
		"#given an oversized first capture #when retry returns %s #then the budget decides image or text only",
		async (size) => {
			const frames = decisionFrames();
			try {
				const capture = vi.mocked(core.captureWindowViaSck);
				capture
					.mockReturnValueOnce(Buffer.alloc(20_001))
					.mockReturnValueOnce(size === null ? null : Buffer.alloc(size));
				const result = latestDecisionFrame(frames.hotFrames, { pid: 1234, windowId: 71 });
				expect(capture.mock.calls).toEqual([
					[71, 480, 300, "jpeg", 50],
					[71, 320, 200, "jpeg", 30],
				]);
				if (size === 20_000) {
					expect(result?.hash).toBe("frame-a");
					expect(Buffer.from(result?.image ?? "", "base64").byteLength).toBe(20_000);
				} else {
					expect(result).toBeUndefined();
				}
			} finally {
				await frames.hotFrames.dispose();
			}
		},
	);

	it("#given an unchanged hot frame #when a second step decides #then the protocol exposes the actual cache hit", async () => {
		const press = decisionAnswer({
			operation: { choice: "PRESS", confidence: 1 },
			press_target: { choice: "9" },
		});
		const mock = await startDecisionMock([press, press, press]);
		vi.stubEnv("APPLE_CUA_DECISION_ENDPOINT", `http://127.0.0.1:${mock.port}/v1/chat/completions`);
		vi.stubEnv("LLM_POOL_PROXY_API_KEY", "test-key");
		const frames = decisionFrames();
		const computer = new FakeGuardedComputer();
		computer.delivery = "background";
		const harness = await createHarness(computer, undefined, undefined, {
			serverOptions: { hotFramesSource: frames.hotFrames },
		});
		closeHarness = harness.close;

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_decision",
				arguments: { app: "Finder", goal: "Open the thing", max_steps: 2 },
			}),
		);

		expect(payload["executed"]).toBe(2);
		expect(payload["steps"]).toEqual([
			expect.objectContaining({ status: "ran" }),
			expect.objectContaining({ status: "ran", cache: "hit" }),
		]);
	});

	it("#given answers for one frame #when preflight observes a changed frame #then no stale action dispatches", async () => {
		const mock = await startDecisionMock([
			decisionAnswer({ operation: { choice: "PRESS", confidence: 1 }, press_target: { choice: "9" } }),
		]);
		vi.stubEnv("APPLE_CUA_DECISION_ENDPOINT", `http://127.0.0.1:${mock.port}/v1/chat/completions`);
		vi.stubEnv("LLM_POOL_PROXY_API_KEY", "test-key");
		const frames = decisionFrames();
		const computer = new FakeGuardedComputer();
		computer.delivery = "background";
		vi.spyOn(computer, "preflightInput").mockImplementation(async () => {
			frames.frame("frame-b");
			return { ok: true };
		});
		const harness = await createHarness(computer, undefined, undefined, {
			serverOptions: { hotFramesSource: frames.hotFrames },
		});
		closeHarness = harness.close;

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_decision",
				arguments: { app: "Finder", goal: "Open the thing", max_steps: 1 },
			}),
		);

		expect(payload["executed"]).toBe(0);
		expect(payload["steps"]).toEqual([
			expect.objectContaining({ status: "refused", detail: "stale-frame: hot frame changed before dispatch" }),
		]);
		expect(computer.effects.some((effect) => effect.kind === "performAction")).toBe(false);
	});
});

describe("#given a configured decision endpoint #when run_decision steps through an app #then each step runs guarded and is recorded", () => {
	it("runs one low-risk press and refuses an unverified DONE", async () => {
		const mock = await startDecisionMock([
			decisionAnswer({
				operation: { choice: "PRESS", confidence: 0.8 },
				press_target: { choice: "9", confidence: 0.8 },
				risk: { score: 0 },
				risk_class: { choice: "reversible_ui" },
				blocked: { noul: 0.02 },
				goal_satisfied: { noul: 0.05 },
			}),
			decisionAnswer({
				operation: { choice: "DONE", confidence: 0.9 },
				risk: { score: 0 },
				risk_class: { choice: "reversible_ui" },
				blocked: { noul: 0.02 },
				goal_satisfied: { noul: 0.95 },
			}),
		]);
		vi.stubEnv("APPLE_CUA_DECISION_ENDPOINT", `http://127.0.0.1:${mock.port}/v1/chat/completions`);
		vi.stubEnv("LLM_POOL_PROXY_API_KEY", "test-key");

		const computer = new FakeGuardedComputer();
		computer.delivery = "background";
		const harness = await createHarness(computer);
		closeHarness = harness.close;

		const result = await harness.client.callTool({
			name: "run_decision",
			arguments: { app: "Finder", goal: "Open the thing", max_steps: 4 },
		});
		const payload = jsonPayload(result);

		expect(payload["executed"]).toBe(1);
		expect(payload["last_status"]).toBe("refused");
		const steps = payload["steps"] as { status: string; operation?: string; detail: string }[];
		expect(steps).toHaveLength(2);
		expect(steps[0]).toMatchObject({ status: "ran", operation: "PRESS" });
		expect(steps[1]?.detail).toContain("no verifier confirmed");
		const performActions = harness.computer.effects.filter((effect) => effect.kind === "performAction");
		expect(performActions.length).toBeGreaterThan(0);
	});

	it("records a preflight refusal without dispatching the proposed action", async () => {
		const mock = await startDecisionMock([
			decisionAnswer({
				operation: { choice: "PRESS", confidence: 0.8 },
				press_target: { choice: "9", confidence: 0.8 },
				risk: { score: 0 },
				risk_class: { choice: "reversible_ui" },
				blocked: { noul: 0.02 },
				goal_satisfied: { noul: 0.05 },
			}),
		]);
		vi.stubEnv("APPLE_CUA_DECISION_ENDPOINT", `http://127.0.0.1:${mock.port}/v1/chat/completions`);
		vi.stubEnv("LLM_POOL_PROXY_API_KEY", "test-key");

		const computer = new FakeGuardedComputer();
		computer.preflightResult = { ok: false, reason: "window-missing" };
		const harness = await createHarness(computer);
		closeHarness = harness.close;

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_decision",
				arguments: { app: "Finder", goal: "Open the thing", max_steps: 1 },
			}),
		);
		const steps = payload["steps"] as { status: string; detail: string }[];

		expect(payload["executed"]).toBe(0);
		expect(steps).toHaveLength(1);
		expect(steps[0]).toMatchObject({ status: "refused", detail: "window-missing" });
		expect(computer.effects.some((effect) => effect.kind === "performAction")).toBe(false);
	});

	it("caps recorded decision steps and rejects zero max_steps", async () => {
		const press = decisionAnswer({
			operation: { choice: "PRESS", confidence: 0.8 },
			press_target: { choice: "9", confidence: 0.8 },
			risk: { score: 0 },
			risk_class: { choice: "reversible_ui" },
			blocked: { noul: 0.02 },
			goal_satisfied: { noul: 0.05 },
		});
		const responses = [press, press, press];
		const mock = await startDecisionMock(responses);
		vi.stubEnv("APPLE_CUA_DECISION_ENDPOINT", `http://127.0.0.1:${mock.port}/v1/chat/completions`);
		vi.stubEnv("LLM_POOL_PROXY_API_KEY", "test-key");

		const computer = new FakeGuardedComputer();
		computer.delivery = "background";
		const harness = await createHarness(computer);
		closeHarness = harness.close;

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_decision",
				arguments: { app: "Finder", goal: "Open the thing", max_steps: 1 },
			}),
		);
		expect(payload["executed"]).toBe(1);
		expect(payload["steps"]).toHaveLength(1);
		expect(responses).toHaveLength(2);

		const invalid = await harness.client.callTool({
			name: "run_decision",
			arguments: { app: "Finder", goal: "Open the thing", max_steps: 0 },
		});
		expect(invalid.isError).toBe(true);
		expect(responses).toHaveLength(2);
	});
});

describe("#given no decision endpoint #when run_decision is called #then it refuses with the setup instruction", () => {
	it("fails closed with the env names", async () => {
		vi.stubEnv("APPLE_CUA_DECISION_ENDPOINT", "");
		vi.stubEnv("LLM_POOL_PROXY_API_KEY", "");
		vi.stubEnv("TYPESAFE_API_KEY", "");

		const harness = await createHarness(new FakeGuardedComputer());
		closeHarness = harness.close;

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_decision",
				arguments: { app: "Finder", goal: "anything" },
			}),
		);

		expect(payload["effect"]).toBe("refused");
		expect(payload["reason"]).toBe("decision-endpoint-not-configured");
	});
});

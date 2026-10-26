import type { Server } from "node:http";
import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarness, jsonPayload } from "./protocol-client-harness.js";
import { FakeGuardedComputer } from "./protocol-test-harness.js";

let closeHarness: (() => Promise<void>) | undefined;
let mockServer: Server | undefined;

afterEach(async () => {
	await closeHarness?.();
	closeHarness = undefined;
	mockServer?.close();
	mockServer = undefined;
	vi.unstubAllEnvs();
});

function startDecisionMock(responses: unknown[]): Promise<{ readonly port: number }> {
	const server = createServer((request, response) => {
		let body = "";
		request.on("data", (chunk) => {
			body += chunk;
		});
		request.on("end", () => {
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
		expect(steps[1].detail).toContain("no verifier confirmed");
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

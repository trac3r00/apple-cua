import type { ElicitRequest, ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, jsonPayload, observe } from "./protocol-client-harness.js";
import { lockRefusalResult } from "./tool-result.js";

let closeHarness: (() => Promise<void>) | undefined;
afterEach(async () => {
	await closeHarness?.();
	closeHarness = undefined;
});

async function elicitingHarness(onElicit: (request: ElicitRequest) => ElicitResult | Promise<ElicitResult>) {
	const harness = await createHarness(undefined, undefined, undefined, {
		capabilities: { elicitation: {} },
		onElicit,
	});
	closeHarness = harness.close;
	return harness;
}

describe("ask_user #given an eliciting client #when the human responds #then the response is structured", () => {
	it("returns the selected choice when accepted", async () => {
		let request: ElicitRequest | undefined;
		const harness = await elicitingHarness((received) => {
			request = received;
			return { action: "accept", content: { choice: "Save draft" } };
		});

		const result = await harness.client.callTool({
			name: "ask_user",
			arguments: { question: "What next?", options: ["Save draft", "Discard"], reason: "ambiguous_target" },
		});

		expect(result.isError).not.toBe(true);
		expect(jsonPayload(result)).toMatchObject({ answered: true, action: "accept", choice: "Save draft" });
		expect(request?.params).toMatchObject({
			message: "What next?",
			requestedSchema: { properties: { choice: { type: "string", enum: ["Save draft", "Discard"] } } },
		});
	});

	it("does not accept a choice the human was not offered", async () => {
		const harness = await elicitingHarness(() => ({ action: "accept", content: { choice: "Delete everything" } }));

		const result = await harness.client.callTool({
			name: "ask_user",
			arguments: { question: "What next?", options: ["Save draft", "Discard"] },
		});

		expect(result.isError).not.toBe(true);
		expect(jsonPayload(result)).toMatchObject({ needs_user: true, question: "What next?" });
	});

	it("returns the free-text answer when accepted", async () => {
		const harness = await elicitingHarness(() => ({ action: "accept", content: { answer: "Quarterly report" } }));

		const result = await harness.client.callTool({
			name: "ask_user",
			arguments: { question: "Which document?", reason: "needs_value", allow_free_text: true },
		});

		expect(result.isError).not.toBe(true);
		expect(jsonPayload(result)).toEqual({ answered: true, action: "accept", answer: "Quarterly report" });
	});

	it.each(["decline", "cancel"] as const)("returns unanswered when the human chooses %s", async (action) => {
		const harness = await elicitingHarness(() => ({ action }));

		const result = await harness.client.callTool({ name: "ask_user", arguments: { question: "Proceed?" } });

		expect(result.isError).not.toBe(true);
		expect(jsonPayload(result)).toEqual({ answered: false, action });
	});

	it.each(["handoff", "screen_locked"] as const)(
		"returns a fresh observation after an accepted %s answer",
		async (reason) => {
			const harness = await elicitingHarness(() => ({ action: "accept", content: { answer: "Done" } }));
			const previousToken = await observe(harness);

			const result = await harness.client.callTool({
				name: "ask_user",
				arguments: { question: "Please finish signing in", reason, app: "Finder" },
			});
			const payload = jsonPayload(result);

			expect(result.isError).not.toBe(true);
			expect(payload).toMatchObject({ answered: true, action: "accept", answer: "Done", app: "Finder" });
			expect(payload["observation_token"]).toEqual(expect.any(String));
			expect(payload["observation_token"]).not.toBe(previousToken);
		},
	);
});

describe("ask_user #given elicitation is unavailable #when called #then the agent must relay the question", () => {
	it("returns a non-error fallback without a capable client", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;

		const result = await harness.client.callTool({
			name: "ask_user",
			arguments: { question: "Which app?", options: ["Finder", "Other"], reason: "ambiguous_target" },
		});

		expect(result.isError).not.toBe(true);
		expect(jsonPayload(result)).toMatchObject({
			needs_user: true,
			question: "Which app?",
			options: ["Finder", "Other"],
			reason: "ambiguous_target",
			instruction: expect.stringContaining("Do not guess"),
		});
	});

	it("returns the fallback when a capable client cannot elicit", async () => {
		const harness = await elicitingHarness(() => {
			throw new Error("client unavailable");
		});

		const result = await harness.client.callTool({ name: "ask_user", arguments: { question: "Please unlock" } });

		expect(result.isError).not.toBe(true);
		expect(jsonPayload(result)).toMatchObject({ needs_user: true, question: "Please unlock" });
	});
});

describe("human escalation #given a refused policy #when input is attempted #then the caller is directed to ask_user", () => {
	it.each(["app-not-approved", "url-blocked"] as const)("escalates %s to a human", async (reason) => {
		const harness = await createHarness();
		closeHarness = harness.close;
		const token = await observe(harness);
		harness.computer.preflightResult = { ok: false, reason };

		const result = await harness.client.callTool({
			name: "click",
			arguments: { app: "Finder", observation_token: token, element_index: "9" },
		});

		expect(result.isError).toBe(true);
		expect(jsonPayload(result)).toMatchObject({
			actionDispatched: false,
			reason,
			escalation: { target: "human", reason: "needs_user" },
			message: expect.stringContaining("ask_user"),
		});
	});
});

describe("lock escalation #given a locked Mac #when converted to a refusal #then human help is requested", () => {
	it("returns a structured refusal when get_app_state sees a locked screen", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		harness.computer.stateError = new Error(
			"Computer Use is paused because the Mac is locked. Ask the user to unlock the Mac before continuing.",
		);

		const result = await harness.client.callTool({ name: "get_app_state", arguments: { app: "Finder" } });

		expect(result.isError).toBe(true);
		expect(jsonPayload(result)).toMatchObject({
			actionDispatched: false,
			reason: "screen-locked",
			escalation: { target: "human", reason: "screen_locked" },
		});
	});

	it("recognizes the lock message instead of treating it as a generic error", () => {
		const result = lockRefusalResult(
			new Error(
				"Computer Use is paused because the Mac is locked. Ask the user to unlock the Mac before continuing.",
			),
		);
		const payload = jsonPayload(result);

		expect(result?.isError).toBe(true);
		expect(payload).toMatchObject({
			actionDispatched: false,
			reason: "screen-locked",
			escalation: { target: "human", reason: "screen_locked" },
		});
		// The refusal names the question tool so a client without elicitation can still relay it.
		expect(payload["message"]).toEqual(expect.stringContaining("ask_user"));
	});
});

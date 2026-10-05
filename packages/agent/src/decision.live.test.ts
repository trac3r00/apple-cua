import { MacOSHostComputer } from "@apple-cua/core";
import { describe, expect, it } from "vitest";
import { buildMacActionSpace } from "./action-space.js";
import { createDecider } from "./decision.js";

/**
 * The decision half of the loop, live: observe a real app, build the table, and ask the real
 * decision model once. Read-only — it never sends input.
 *
 * Opt-in: APPLE_CUA_LIVE_DECISION=1. Endpoint and model come from the environment so the same test
 * works against a direct TypeSafe endpoint or a proxy that speaks the `{state, questions}` contract.
 */
const enabled = process.env["APPLE_CUA_LIVE_DECISION"] === "1";
const appName = process.env["APPLE_CUA_LIVE_APP"] ?? "Finder";
const endpoint = process.env["APPLE_CUA_DECISION_ENDPOINT"] ?? "http://127.0.0.1:18989/v1/chat/completions";
const model = process.env["APPLE_CUA_DECISION_MODEL"] ?? "typesafe/jev-latest";
const apiKey = process.env["LLM_POOL_PROXY_API_KEY"] ?? process.env["TYPESAFE_API_KEY"];
const goal = process.env["APPLE_CUA_LIVE_GOAL"] ?? "Switch the front window to list view.";

describe.skipIf(!enabled)("#given a live app and a real decision endpoint", () => {
	it("#when one decision is requested #then the table fits the model's budget and the answer is from the offered set", async () => {
		const computer = new MacOSHostComputer();
		try {
			const apps = await computer.listApps();
			const app = apps.find((entry) => entry.name === appName || entry.bundleId === appName);
			expect(app, `${appName} must be running for this probe`).toBeDefined();
			const state = await computer.getAppState(app?.pid ?? 0, { includeScreenshot: false, maxElements: 600 });
			const space = buildMacActionSpace(state);
			const payload = JSON.stringify({
				state: { elements: space.elements, text: space.visibleText },
				questions: {},
			});

			expect(space.elements.length, "the live table must offer something to choose from").toBeGreaterThan(0);
			expect(payload.length, "the table must stay inside the decision model's request budget").toBeLessThan(40_000);

			const decide = createDecider({ endpoint, model, ...(apiKey === undefined ? {} : { apiKey }) });
			const started = Date.now();
			const outcome = await decide({ space, goal, history: [] });
			const elapsed = Date.now() - started;

			expect(elapsed, "one decision must return promptly").toBeLessThan(20_000);
			expect(outcome.ok, `the model refused a well-formed table: ${JSON.stringify(outcome)}`).toBe(true);
			if (!outcome.ok) {
				return;
			}
			expect(space.operations).toContain(outcome.decision.operation);
			if (outcome.decision.target !== undefined) {
				expect(space.targets[outcome.decision.target.operation]?.[outcome.decision.target.index]).toBeDefined();
			}
		} finally {
			await computer.close();
		}
	}, 60_000);
});

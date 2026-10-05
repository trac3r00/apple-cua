import { describe, expect, it } from "vitest";
import { createDecider, questionsFor, validate } from "./decision.js";
import type { ActionSpace } from "./types.js";

const space: ActionSpace = {
	platform: "macos",
	app: "TextEdit",
	elements: [
		{ index: 3, role: "Button", label: "Save", operations: ["PRESS"] },
		{ index: 5, role: "TextArea", label: "Body", operations: ["TYPE_TEXT"] },
	],
	visibleText: ["Meeting notes"],
	targets: {
		PRESS: {
			3: {
				operation: "PRESS",
				index: 3,
				label: "Save",
				role: "Button",
				expectLabel: "Save",
				expectRole: "AXButton",
			},
		},
		TYPE_TEXT: {
			5: {
				operation: "TYPE_TEXT",
				index: 5,
				label: "Body",
				role: "TextArea",
				expectLabel: "Body",
				expectRole: "AXTextArea",
			},
		},
	},
	operations: ["PRESS", "TYPE_TEXT"],
	truncated: false,
	pruned: 0,
	sparse: false,
};

function answer(content: unknown) {
	return { choices: [{ message: { content: JSON.stringify(content) } }] };
}

describe("questionsFor", () => {
	it("#given a table with two operations #when the questions are built #then each operation gets its own target head", () => {
		const questions = questionsFor(space);

		expect(Object.keys(questions).sort()).toStrictEqual([
			"blocked",
			"goal_satisfied",
			"operation",
			"press_target",
			"risk",
			"risk_class",
			"type_text_target",
		]);
		const press = questions["press_target"];
		expect(press?.type).toBe("choice");
		const criteria = press !== undefined && press.type === "choice" ? Object.keys(press.criteria) : [];
		expect(criteria).toStrictEqual(["3"]);
	});

	it("#given a table with no typeable field #when the questions are built #then no type head is asked", () => {
		const questions = questionsFor({
			...space,
			targets: space.targets.PRESS === undefined ? {} : { PRESS: space.targets.PRESS },
			operations: ["PRESS"],
		});

		expect(questions["type_text_target"]).toBeUndefined();
	});
});

describe("validate", () => {
	it("#given an offered operation with its target #when the answer is validated #then the target resolves to the observed element", () => {
		const outcome = validate(
			{
				operation: { choice: "PRESS", confidence: 0.91 },
				press_target: { choice: "3" },
				risk: { score: 0 },
				risk_class: { choice: "reversible_ui" },
				blocked: { noul: 0.02 },
				goal_satisfied: { noul: 0.04 },
			},
			space,
		);

		expect(outcome.ok).toBe(true);
		if (!outcome.ok) {
			return;
		}
		expect(outcome.decision.confidence).toBe(0.91);
		expect(outcome.decision.target?.index).toBe(3);
		expect(outcome.decision.risk).toBe(0);
		expect(outcome.decision.riskClass).toBe("reversible_ui");
	});

	it("#given an operation the table never offered #when the answer is validated #then nothing is accepted", () => {
		const outcome = validate({ operation: { choice: "MENU" } }, space);

		expect(outcome.ok).toBe(false);
		if (outcome.ok) {
			return;
		}
		expect(outcome.refusal.reason).toBe("unknown-operation");
	});

	it("#given a press naming an element that was not offered #when the answer is validated #then it is refused", () => {
		const outcome = validate({ operation: { choice: "PRESS" }, press_target: { choice: "99" } }, space);

		expect(outcome.ok).toBe(false);
		if (outcome.ok) {
			return;
		}
		expect(outcome.refusal.reason).toBe("target-not-offered");
	});

	it("#given a targeted operation with no target #when the answer is validated #then it is refused", () => {
		const outcome = validate({ operation: { choice: "TYPE_TEXT" } }, space);

		expect(outcome.ok).toBe(false);
		if (outcome.ok) {
			return;
		}
		expect(outcome.refusal.reason).toBe("missing-target");
	});

	it("#given the top risk level #when the answer is validated #then the score becomes a risk of one", () => {
		const outcome = validate(
			{ operation: { choice: "DONE" }, risk: { score: 4 }, risk_class: { choice: "sends_or_publishes" } },
			{ ...space, operations: ["DONE"] },
		);

		expect(outcome.ok).toBe(true);
		if (!outcome.ok) {
			return;
		}
		expect(outcome.decision.risk).toBe(1);
		expect(outcome.decision.riskClass).toBe("sends_or_publishes");
	});

	it("#given a risk class outside the vocabulary #when the answer is validated #then the harmless class is assumed", () => {
		const outcome = validate(
			{ operation: { choice: "BLOCKED" }, risk_class: { choice: "definitely_fine" } },
			{ ...space, operations: ["BLOCKED"] },
		);

		expect(outcome.ok).toBe(true);
		if (!outcome.ok) {
			return;
		}
		expect(outcome.decision.riskClass).toBe("reversible_ui");
	});
});

describe("createDecider", () => {
	it("#given a decision endpoint #when a decision is requested #then one call carries the state and every question", async () => {
		let seen: { url: string; body: unknown } | undefined;
		const decide = createDecider({
			endpoint: "http://127.0.0.1:9/v1/chat/completions",
			model: "typesafe/jev-latest",
			fetchImpl: async (input, init) => {
				seen = { url: String(input), body: JSON.parse(String(init?.body)) };
				return new Response(
					JSON.stringify(
						answer({
							answers: {
								operation: { choice: "PRESS", confidence: 0.8 },
								press_target: { choice: "3" },
								risk: { score: 0 },
								risk_class: { choice: "reversible_ui" },
								blocked: { noul: 0 },
								goal_satisfied: { noul: 0 },
							},
						}),
					),
					{ status: 200 },
				);
			},
		});

		const outcome = await decide({ space, goal: "save the note", history: [] });

		expect(outcome.ok).toBe(true);
		const body = seen?.body as { model: string; messages: Array<{ role: string; content: string }> } | undefined;
		expect(body?.model).toBe("typesafe/jev-latest");
		expect(body?.messages).toHaveLength(1);
		const payload = JSON.parse(body?.messages[0]?.content ?? "{}") as { state?: unknown; questions?: unknown };
		expect(payload.state).toBeDefined();
		expect(payload.questions).toBeDefined();
	});

	it("#given an endpoint that fails #when a decision is requested #then the failure surfaces instead of a decision", async () => {
		const decide = createDecider({
			endpoint: "http://127.0.0.1:9/v1/chat/completions",
			model: "typesafe/jev-latest",
			fetchImpl: async () => new Response("boom", { status: 500 }),
		});

		await expect(decide({ space, goal: "save the note", history: [] })).rejects.toThrow(/HTTP 500/);
	});
});

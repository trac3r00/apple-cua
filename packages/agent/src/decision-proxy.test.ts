import { afterEach, describe, expect, it } from "vitest";
import {
	fromGatewayAnswers,
	handleChatRequest,
	stripProviderPrefix,
	toGatewayQuestions,
	translateChatToSystemone,
	wrapSystemoneAsChat,
} from "./decision-proxy.js";

const CONTRACT = {
	state: { goal: "Compute 5 + 3", app: "Calculator", elements: [{ id: 1, label: "5" }], recent: [] },
	questions: { operation: { type: "choice", criteria: { PRESS: "Press it.", DONE: "Done." } } },
};

describe("#given a chat-completions body #when it carries the contract in its user message #then it becomes a systemone request", () => {
	it("translates a JSON-string user message and strips the provider prefix", () => {
		const body = {
			model: "typesafe/jev-latest",
			messages: [{ role: "user", content: JSON.stringify(CONTRACT) }],
		};
		const translated = translateChatToSystemone(body, "jev-latest");
		expect(translated.model).toBe("jev-latest");
		expect(translated.state).toEqual(CONTRACT.state);
		expect(translated.questions).toEqual(CONTRACT.questions);
	});

	it("translates an object user message as-is", () => {
		const translated = translateChatToSystemone(
			{ model: "typesafe/jev-latest", messages: [{ role: "user", content: CONTRACT }] },
			"jev-latest",
		);
		expect(translated.state).toEqual(CONTRACT.state);
	});

	it("keeps extra state fields so new contract surface (images included) flows through", () => {
		const extended = {
			state: { ...CONTRACT.state, image: "c29tZS1wbmc=" },
			questions: CONTRACT.questions,
		};
		const translated = translateChatToSystemone({ messages: [{ role: "user", content: extended }] }, "jev-latest");
		expect((translated.state as { image?: string }).image).toBe("c29tZS1wbmc=");
	});

	it.each([
		["no user message", { messages: [] }, /no user message/],
		["no state", { messages: [{ role: "user", content: { questions: {} } }] }, /missing state or questions/],
		["broken json", { messages: [{ role: "user", content: "{not json" }] }, /not valid contract JSON/],
	])("%s is refused as a bad request", (_label, body, pattern) => {
		expect(() => translateChatToSystemone(body, "jev-latest")).toThrowError(pattern);
	});
});

describe("#given a chat body #when the model name carries a prefix #then only the prefix is stripped", () => {
	it("leaves unprefixed names alone", () => {
		expect(stripProviderPrefix("jev-latest")).toBe("jev-latest");
		expect(stripProviderPrefix("typesafe/jev-latest")).toBe("jev-latest");
	});
});

describe("#given a systemone answer #when it is wrapped #then the decision layer can read it", () => {
	it("puts the raw result inside one assistant message", () => {
		const wrapped = wrapSystemoneAsChat({ answers: { operation: { choice: "PRESS", confidence: 0.9 } } }) as {
			choices: { message: { content: string } }[];
		};
		const decoded = JSON.parse(wrapped.choices[0].message.content) as {
			answers: { operation: { choice: string } };
		};
		expect(decoded.answers.operation.choice).toBe("PRESS");
	});
});

describe("#given the proxy handler #when the upstream answers #then the chat shape returns", () => {
	it("end-to-end one request against a stub upstream", async () => {
		const payload = await handleChatRequest(
			JSON.stringify({ model: "typesafe/jev-latest", messages: [{ role: "user", content: CONTRACT }] }),
			{
				fallbackModel: "jev-latest",
				systemoneEndpoint: "https://stub.typesafe.invalid/v1/systemone",
				apiKey: "test-key",
				fetchImpl: (async () =>
					new Response(JSON.stringify({ answers: { operation: { choice: "PRESS", confidence: 0.9 } } }), {
						status: 200,
					})) as typeof fetch,
			},
		);
		const wrapped = payload as { choices: { message: { content: string } }[] };
		expect(JSON.parse(wrapped.choices[0].message.content)).toMatchObject({
			answers: { operation: { choice: "PRESS" } },
		});
	});

	it("surfaces an upstream error status as the proxy error", async () => {
		let raised: unknown;
		try {
			await handleChatRequest(JSON.stringify({ messages: [{ role: "user", content: CONTRACT }] }), {
				fallbackModel: "jev-latest",
				systemoneEndpoint: "https://stub.typesafe.invalid/v1/systemone",
				apiKey: "test-key",
				fetchImpl: (async () => new Response("Cannot authenticate", { status: 401 })) as typeof fetch,
			});
		} catch (error) {
			raised = error;
		}
		expect(raised).toBeInstanceOf(Object);
		expect(String((raised as { status?: number }).status)).toBe("401");
	});
});

const GATEWAY_QUESTIONS = {
	operation: { type: "choice", instructions: { text: "pick" }, criteria: { PRESS: { when: "press" }, DONE: "Done." } },
	risk: { type: "score", instructions: "Rate risk.", criteria: ["none", "low", "mid", "high", "max"] },
	blocked: { type: "noul", instructions: "Blocked?" },
};

describe("#given gateway-decisions mode #when questions are translated #then only choice and noul with string values remain", () => {
	it("maps score to noul and stringifies object instructions and criteria", () => {
		const { questions, scoreKeys } = toGatewayQuestions(GATEWAY_QUESTIONS) as {
			questions: Record<string, { type: string; instructions?: unknown; criteria?: unknown }>;
			scoreKeys: string[];
		};
		expect(scoreKeys).toEqual(["risk"]);
		expect(questions.risk).toEqual({ type: "noul", instructions: "Rate risk." });
		expect(questions.operation.instructions).toBe('{"text":"pick"}');
		expect(questions.operation.criteria).toEqual({ PRESS: '{"when":"press"}', DONE: "Done." });
		expect(questions.blocked).toEqual(GATEWAY_QUESTIONS.blocked);
	});

	it("maps the noul answer back to a score and leaves other answers alone", () => {
		const mapped = fromGatewayAnswers(
			{ answers: { operation: { choice: "PRESS" }, risk: { noul: 0.5 } }, usage: { tokens: 1 } },
			["risk"],
		);
		expect(mapped).toEqual({
			answers: { operation: { choice: "PRESS" }, risk: { score: 2 } },
			usage: { tokens: 1 },
		});
	});

	it("passes state through and posts translated questions while mode off stays unchanged", async () => {
		const bodies: unknown[] = [];
		const contract = { state: { ...CONTRACT.state, image: "abc" }, questions: GATEWAY_QUESTIONS };
		const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
			bodies.push(JSON.parse(String(init?.body)));
			return new Response(JSON.stringify({ answers: { risk: { noul: 0.25 } } }), { status: 200 });
		}) as typeof fetch;
		const base = {
			fallbackModel: "jev-latest",
			systemoneEndpoint: "https://stub.invalid/v1",
			apiKey: "k",
			fetchImpl,
		};
		const raw = JSON.stringify({ model: "sionic-ai/jev-omni", messages: [{ role: "user", content: contract }] });
		const on = (await handleChatRequest(raw, { ...base, mode: "gateway-decisions" })) as {
			choices: { message: { content: string } }[];
		};
		await handleChatRequest(raw, base);
		const [gatewayBody, plainBody] = bodies as { model: string; state: unknown; questions: unknown }[];
		expect(gatewayBody.model).toBe("sionic-ai/jev-omni");
		expect(gatewayBody.state).toEqual(contract.state);
		expect(JSON.stringify(gatewayBody.questions)).not.toContain('"score"');
		expect(plainBody.questions).toEqual(GATEWAY_QUESTIONS);
		expect(JSON.parse(on.choices[0].message.content)).toEqual({ answers: { risk: { score: 1 } } });
	});

	it("uses the gateway fallback model for the legacy TypeSafe model alias", async () => {
		let postedModel: string | undefined;
		await handleChatRequest(
			JSON.stringify({ model: "typesafe/jev-latest", messages: [{ role: "user", content: CONTRACT }] }),
			{
				fallbackModel: "sionic-ai/jev-omni",
				systemoneEndpoint: "https://stub.invalid/v1",
				apiKey: "test-key",
				mode: "gateway-decisions",
				fetchImpl: (async (_url: unknown, init?: RequestInit) => {
					postedModel = (JSON.parse(String(init?.body)) as { model: string }).model;
					return new Response(JSON.stringify({ answers: { operation: { choice: "PRESS" } } }), {
						status: 200,
					});
				}) as typeof fetch,
			},
		);
		expect(postedModel).toBe("sionic-ai/jev-omni");
	});
});

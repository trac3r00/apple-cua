import type { IncomingMessage, ServerResponse } from "node:http";

export interface ChatCompletionBody {
	readonly model?: string;
	readonly messages?: readonly { readonly role?: string; readonly content?: unknown }[];
}

export interface SystemoneBody {
	readonly model: string;
	readonly state: unknown;
	readonly questions: unknown;
}

export class ProxyError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

/**
 * Translate one OpenAI-style chat-completions request whose only user message carries the
 * `{state, questions}` decision contract into a native TypeSafe `systemone` request. The model
 * name loses its provider prefix ("typesafe/jev-latest" -> "jev-latest"); everything else in the
 * first user message passes through untouched, so whatever the state contract grows (images
 * included) keeps flowing to the decision model.
 */
export function translateChatToSystemone(body: unknown, fallbackModel: string): SystemoneBody {
	if (typeof body !== "object" || body === null) {
		throw new ProxyError(400, "request body was not an object");
	}
	const chat = body as ChatCompletionBody;
	const message = chat.messages?.find((candidate) => candidate.role === "user");
	if (message === undefined || message.content === undefined) {
		throw new ProxyError(400, "chat request carried no user message with the {state, questions} contract");
	}
	let contract: unknown = message.content;
	if (typeof contract === "string") {
		try {
			contract = JSON.parse(contract);
		} catch {
			throw new ProxyError(400, "user message was not valid contract JSON");
		}
	}
	const model = chat.model ?? fallbackModel;
	return {
		model: stripProviderPrefix(model),
		state: toContract(contract).state,
		questions: toContract(contract).questions,
	};
}

function toContract(contract: unknown): { readonly state: unknown; readonly questions: unknown } {
	if (typeof contract !== "object" || contract === null) {
		throw new ProxyError(400, "decision contract was not an object");
	}
	const record = contract as { state?: unknown; questions?: unknown };
	if (record.state === undefined || record.questions === undefined) {
		throw new ProxyError(400, "decision contract is missing state or questions");
	}
	return { state: record.state, questions: record.questions };
}

export function stripProviderPrefix(model: string): string {
	return model.startsWith("typesafe/") ? model.slice("typesafe/".length) : model;
}

export function wrapSystemoneAsChat(result: unknown): unknown {
	return {
		choices: [
			{
				message: {
					role: "assistant",
					content: JSON.stringify(result),
				},
			},
		],
	};
}

/** The decision layer reads `risk.score` on a 0-4 scale; keep in step with RISK_LEVELS in decision.ts. */
const GATEWAY_RISK_SCORE_SPAN = 4;

export interface GatewayTranslation {
	readonly questions: unknown;
	readonly scoreKeys: readonly string[];
}

function stringify(value: unknown): string {
	return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * The OmO gateway `/v1/decisions` only speaks `choice` and `noul` questions with string
 * instructions/criteria. `score` questions become `noul` (instructions kept) and are remembered so
 * their answers can be mapped back; non-string instructions/criteria values are stringified.
 */
export function toGatewayQuestions(questions: unknown): GatewayTranslation {
	if (typeof questions !== "object" || questions === null) {
		return { questions, scoreKeys: [] };
	}
	const scoreKeys: string[] = [];
	const translated: Record<string, unknown> = {};
	for (const [key, raw] of Object.entries(questions)) {
		if (typeof raw !== "object" || raw === null) {
			translated[key] = raw;
			continue;
		}
		const question = raw as { type?: unknown; instructions?: unknown; criteria?: unknown };
		const instructions =
			question.instructions === undefined ? {} : { instructions: stringify(question.instructions) };
		if (question.type === "score") {
			scoreKeys.push(key);
			translated[key] = { type: "noul", ...instructions };
			continue;
		}
		let criteria: unknown = question.criteria;
		if (typeof criteria === "object" && criteria !== null && !Array.isArray(criteria)) {
			criteria = Object.fromEntries(Object.entries(criteria).map(([name, value]) => [name, stringify(value)]));
		}
		translated[key] = { ...question, ...instructions, ...(criteria === undefined ? {} : { criteria }) };
	}
	return { questions: translated, scoreKeys };
}

/** Map each translated score question's `noul` probability back to a `score` on the 0-4 scale. */
export function fromGatewayAnswers(result: unknown, scoreKeys: readonly string[]): unknown {
	if (scoreKeys.length === 0 || typeof result !== "object" || result === null) {
		return result;
	}
	const record = result as { answers?: unknown };
	if (typeof record.answers !== "object" || record.answers === null) {
		return result;
	}
	const answers: Record<string, unknown> = { ...record.answers };
	for (const key of scoreKeys) {
		const answer = answers[key];
		const noul = typeof answer === "object" && answer !== null ? (answer as { noul?: unknown }).noul : undefined;
		if (typeof noul === "number") {
			answers[key] = { score: noul * GATEWAY_RISK_SCORE_SPAN };
		}
	}
	return { ...record, answers };
}

export async function postToSystemone(
	endpoint: string,
	apiKey: string,
	request: SystemoneBody,
	fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
	let lastError: string | undefined;
	for (let attempt = 0; attempt < 3; attempt++) {
		let response: Response;
		try {
			response = await fetchImpl(endpoint, {
				method: "POST",
				headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
				body: JSON.stringify(request),
				signal: AbortSignal.timeout(30_000),
			});
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
			continue;
		}
		if (response.status === 429 || response.status === 529 || response.status === 503) {
			if (attempt < 2) {
				await new Promise((resolvePromise) => setTimeout(resolvePromise, 500 * 2 ** attempt));
				continue;
			}
		}
		const text = await response.text();
		if (!response.ok) {
			throw new ProxyError(response.status, text.slice(0, 300));
		}
		try {
			return JSON.parse(text);
		} catch {
			throw new ProxyError(502, "systemone returned a non-JSON body");
		}
	}
	throw new ProxyError(502, lastError === undefined ? "systemone unavailable" : `systemone unavailable: ${lastError}`);
}

export async function handleChatRequest(
	rawBody: string,
	options: {
		readonly fallbackModel: string;
		readonly systemoneEndpoint: string;
		readonly apiKey: string;
		readonly fetchImpl?: typeof fetch;
		readonly mode?: "gateway-decisions";
	},
): Promise<unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawBody);
	} catch {
		throw new ProxyError(400, "request body was not valid JSON");
	}
	const request = translateChatToSystemone(parsed, options.fallbackModel);
	if (options.mode === "gateway-decisions") {
		const model = typeof parsed === "object" && parsed !== null ? (parsed as ChatCompletionBody).model : undefined;
		const gatewayRequest = model === "typesafe/jev-latest" ? { ...request, model: options.fallbackModel } : request;
		const gateway = toGatewayQuestions(request.questions);
		const raw = await postToSystemone(
			options.systemoneEndpoint,
			options.apiKey,
			{ ...gatewayRequest, questions: gateway.questions },
			options.fetchImpl,
		);
		return wrapSystemoneAsChat(fromGatewayAnswers(raw, gateway.scoreKeys));
	}
	const result = await postToSystemone(options.systemoneEndpoint, options.apiKey, request, options.fetchImpl);
	return wrapSystemoneAsChat(result);
}

export function respondWithError(response: ServerResponse, error: unknown): void {
	if (error instanceof ProxyError) {
		response.statusCode = error.status;
		response.end(JSON.stringify({ error: { message: error.message } }));
		return;
	}
	response.statusCode = 502;
	response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }));
}

export type { IncomingMessage, ServerResponse };

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { handleChatRequest, respondWithError } from "../packages/agent/dist/decision-proxy.js";

const PORT = Number(process.env.LLM_POOL_SYSTEMONE_PORT ?? 18989);
const GATEWAY_MODE = process.env.LLM_POOL_UPSTREAM_MODE === "gateway-decisions";
const ENDPOINT = GATEWAY_MODE
	? (process.env.LLM_POOL_GATEWAY_URL ?? "http://127.0.0.1:44771/v1/decisions")
	: (process.env.TYPESAFE_ENDPOINT ?? "https://api.typesafe.ai/v1/systemone");
const FALLBACK_MODEL = process.env.TYPESAFE_MODEL ?? (GATEWAY_MODE ? "sionic-ai/jev-omni" : "jev-latest");

function gatewayKeyFromAuth() {
	try {
		const auth = JSON.parse(readFileSync(join(homedir(), ".omo", "agent", "auth.json"), "utf8"));
		return auth?.providers?.opengateway?.key ?? auth?.opengateway?.key;
	} catch {
		return undefined;
	}
}

const apiKey =
	process.env.LLM_POOL_PROXY_API_KEY ??
	(GATEWAY_MODE ? gatewayKeyFromAuth() : undefined) ??
	process.env.TYPESAFE_API_KEY;

if (apiKey === undefined || apiKey === "") {
	process.stderr.write(
		"[llm-pool-systemone] no key: set LLM_POOL_PROXY_API_KEY, TYPESAFE_API_KEY, or the opengateway key in ~/.omo/agent/auth.json\n",
	);
	process.exit(1);
}

const server = createServer((request, response) => {
	if (request.method !== "POST" || !request.url?.startsWith("/v1/chat/completions")) {
		response.statusCode = 404;
		response.end(JSON.stringify({ error: { message: "only POST /v1/chat/completions is served" } }));
		return;
	}
	const chunks = [];
	request.on("data", (chunk) => chunks.push(chunk));
	request.on("end", () => {
		const rawBody = Buffer.concat(chunks).toString("utf8");
		handleChatRequest(rawBody, {
			fallbackModel: FALLBACK_MODEL,
			systemoneEndpoint: ENDPOINT,
			apiKey,
			...(GATEWAY_MODE ? { mode: "gateway-decisions" } : {}),
		})
			.then((payload) => {
				response.statusCode = 200;
				response.setHeader("content-type", "application/json");
				response.end(JSON.stringify(payload));
			})
			.catch((error) => {
				respondWithError(response, error);
			});
	});
	request.on("error", () => {
		respondWithError(response, new Error("request stream failed"));
	});
});

server.listen(PORT, "127.0.0.1", () => {
	process.stdout.write(
		`[llm-pool-systemone] listening on http://127.0.0.1:${PORT}/v1/chat/completions -> ${ENDPOINT}\n`,
	);
});

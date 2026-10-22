export type HostName = "omo" | "claude-code" | "codex" | "pi" | "openclaw" | "hermes" | "gemini" | "cursor" | "unknown";

export interface HostInfo {
	readonly name: HostName;
	readonly source: "client_info" | "environment" | "none";
	readonly clientName?: string;
	readonly clientVersion?: string;
}

export function detectHost(
	clientInfo: { readonly name: string; readonly version?: string } | undefined,
	environment: Readonly<Record<string, string | undefined>>,
): HostInfo {
	const name = clientInfo?.name.trim().toLowerCase();
	let detected: HostName | undefined;

	if (name !== undefined) {
		if (name.includes("claude")) detected = "claude-code";
		else if (name.startsWith("codex")) detected = "codex";
		else if (name === "apple-cua-pi-extension" || name.startsWith("pi-") || name === "pi") detected = "pi";
		else if (name.includes("omo") || name.includes("senpi")) detected = "omo";
		else if (name.includes("openclaw")) detected = "openclaw";
		else if (name.includes("hermes")) detected = "hermes";
		else if (name.includes("gemini")) detected = "gemini";
		else if (name.includes("cursor")) detected = "cursor";
	}

	const clientFields = {
		...(clientInfo === undefined ? {} : { clientName: clientInfo.name }),
		...(clientInfo?.version === undefined ? {} : { clientVersion: clientInfo.version }),
	};

	if (detected !== undefined) return { name: detected, source: "client_info", ...clientFields };

	const nonEmpty = (key: string): boolean => (environment[key]?.trim().length ?? 0) > 0;
	let environmentHost: HostName | undefined;
	if (
		nonEmpty("OMO_NATIVE") ||
		nonEmpty("OMO_CODING_AGENT_DIR") ||
		nonEmpty("SENPI_RUNTIME") ||
		nonEmpty("SENPI_CODING_AGENT_DIR")
	) {
		environmentHost = "omo";
	} else if (environment["CLAUDECODE"] === "1") {
		environmentHost = "claude-code";
	} else if (
		Object.entries(environment).some(
			([key, value]) => key.startsWith("CODEX_") && key !== "CODEX_HOME" && (value?.trim().length ?? 0) > 0,
		)
	) {
		environmentHost = "codex";
	} else if (nonEmpty("PI_CODING_AGENT")) {
		environmentHost = "pi";
	} else if (nonEmpty("HERMES_SESSION_ID") || nonEmpty("HERMES_HOME")) {
		environmentHost = "hermes";
	} else if (nonEmpty("OPENCLAW_STATE_DIR")) {
		environmentHost = "openclaw";
	}

	if (environmentHost !== undefined) return { name: environmentHost, source: "environment", ...clientFields };
	return { name: "unknown", source: clientInfo === undefined ? "none" : "client_info", ...clientFields };
}

export interface SpawnGuidance {
	readonly host: HostName;
	readonly concurrent: boolean;
	readonly mechanism: string;
	readonly instructions: string;
}

export function spawnGuidance(host: HostName, delivery: "background" | "attended"): SpawnGuidance {
	let mechanism: string;
	let instructions: string;

	switch (host) {
		case "omo":
			mechanism = "task tool";
			instructions =
				"Spawn one `task` child per worker with run_in_background true in a single call, put worker_id and observation_token in each prompt, child acts only through run_worker and reports a verified outcome.";
			break;
		case "claude-code":
			mechanism = "Task (Agent) tool";
			instructions =
				"Launch one subagent per worker, all in the same message so they run in parallel, with the same prompt contents.";
			break;
		case "codex":
			mechanism = "subagent tool if available, else run_parallel";
			instructions =
				"If this Codex build exposes a subagent/spawn tool use one per worker, otherwise drive all workers yourself with one run_parallel call.";
			break;
		default:
			mechanism = "run_parallel (or the host's own spawn tool if it has one)";
			instructions = "Drive workers from one agent with one run_parallel call per round.";
	}

	if (delivery === "attended") instructions += " Attended delivery serializes input, so workers run one at a time.";
	return { host, concurrent: delivery === "background", mechanism, instructions };
}

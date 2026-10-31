import { describe, expect, it } from "bun:test";
import { detectHost, spawnGuidance } from "./host-detection.js";

describe("#given client names #when host detection runs #then each named host is recognized", () => {
	it.each([
		["  CLAUDE Desktop ", "claude-code"],
		["Codex CLI", "codex"],
		["apple-cua-pi-extension", "pi"],
		["pi-agent", "pi"],
		["pi", "pi"],
		["Senpi runtime", "omo"],
		["openclaw", "openclaw"],
		["Hermes agent", "hermes"],
		["Gemini CLI", "gemini"],
		["Cursor editor", "cursor"],
	] as const)("detects %s as %s", (name, expected) => {
		expect(detectHost({ name, version: "1.2" }, {}).name).toBe(expected);
		expect(detectHost({ name, version: "1.2" }, {}).source).toBe("client_info");
	});
});

describe("#given host environment markers #when client info is absent #then each supported host is recognized", () => {
	it.each([
		[{ OMO_NATIVE: "1" }, "omo"],
		[{ OMO_CODING_AGENT_DIR: "/tmp/omo" }, "omo"],
		[{ SENPI_RUNTIME: "1" }, "omo"],
		[{ SENPI_CODING_AGENT_DIR: "/tmp/senpi" }, "omo"],
		[{ CLAUDECODE: "1" }, "claude-code"],
		[{ CODEX_SESSION: "1" }, "codex"],
		[{ PI_CODING_AGENT: "1" }, "pi"],
		[{ HERMES_SESSION_ID: "session" }, "hermes"],
		[{ HERMES_HOME: "/tmp/hermes" }, "hermes"],
		[{ OPENCLAW_STATE_DIR: "/tmp/openclaw" }, "openclaw"],
	] as const)("detects %j as %s", (environment, expected) => {
		expect(detectHost(undefined, environment).name).toBe(expected);
		expect(detectHost(undefined, environment).source).toBe("environment");
	});
});

describe("#given ambiguous host signals #when detection falls through #then precedence and fallback are preserved", () => {
	it("prefers client info and preserves its original fields", () => {
		expect(detectHost({ name: "Cursor", version: "2" }, { OMO_NATIVE: "1" })).toEqual({
			name: "cursor",
			source: "client_info",
			clientName: "Cursor",
			clientVersion: "2",
		});
	});

	it("does not detect Codex from CODEX_HOME alone", () => {
		expect(detectHost(undefined, { CODEX_HOME: "/tmp/codex" })).toEqual({ name: "unknown", source: "none" });
	});

	it("preserves client fields for an unknown client", () => {
		expect(detectHost({ name: "Other", version: "3" }, {})).toEqual({
			name: "unknown",
			source: "client_info",
			clientName: "Other",
			clientVersion: "3",
		});
	});
});

describe("#given a host and delivery mode #when spawn guidance is requested #then concurrency matches delivery", () => {
	it.each(["omo", "claude-code", "codex", "pi", "openclaw", "hermes", "gemini", "cursor", "unknown"] as const)(
		"returns machine guidance for %s",
		(host) => {
			const background = spawnGuidance(host, "background");
			const attended = spawnGuidance(host, "attended");
			expect(background.host).toBe(host);
			expect(background.concurrent).toBe(true);
			expect(background.mechanism).toBeTruthy();
			expect(attended.host).toBe(host);
			expect(attended.concurrent).toBe(false);
			expect(attended.mechanism).toBe(background.mechanism);
		},
	);
});

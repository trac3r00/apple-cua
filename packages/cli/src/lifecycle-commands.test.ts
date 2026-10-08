import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CursorMotionConfig } from "@apple-cua/core";
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import {
	askForChanges,
	asksToSkip,
	parseClients,
	registerLifecycleCommands,
	requestedChange,
	resolveCursorMotion,
} from "./lifecycle-commands.js";
import { DEFAULT_SETTINGS, changeSettings, saveSettings } from "./settings.js";

const SAVED_MOTION = { style: "magnetic", timing: "fitts" } as const;

function scripted(answers: readonly string[]) {
	const queue = [...answers];
	const questions: string[] = [];
	const said: string[] = [];
	return {
		questions,
		said,
		ask: async (question: string) => {
			questions.push(question);
			return queue.shift() ?? "";
		},
		say: (text: string) => {
			said.push(text);
		},
	};
}

describe("#given a person at the terminal #when apple-cua config asks #then Enter keeps a value and each answer becomes the change", () => {
	it("turns answers into a change and asks again after an answer it cannot use", async () => {
		const session = scripted(["TextEdit, com.apple.finder", "", "lean", "maybe", "on", "omo,windsurf", "omo,codex"]);

		const change = await askForChanges(DEFAULT_SETTINGS, session.ask, session.say);

		expect(change).toEqual({
			allow: ["TextEdit, com.apple.finder"],
			disallow: [],
			delivery: "background",
			toolset: "lean",
			iphone: true,
			register: ["omo", "codex"],
			unregister: [],
		});
		expect(session.said).toContain("  please answer on or off");
		expect(session.said.some((line) => line.includes("unknown MCP client windsurf"))).toBe(true);
		expect(session.questions.some((question) => question.startsWith("  Remove apps"))).toBe(false);
	});

	it("on a first run, registers with the installed clients on Enter and with none on 'none'", async () => {
		const enter = scripted(["", "", "", "", ""]);
		const none = scripted(["", "", "", "", "none"]);

		const accepted = await askForChanges(DEFAULT_SETTINGS, enter.ask, enter.say, ["omo", "claude"]);
		const declined = await askForChanges(DEFAULT_SETTINGS, none.ask, none.say, ["omo", "claude"]);

		expect(accepted.register).toEqual(["omo", "claude"]);
		expect(enter.questions.at(-1)).toContain("Enter registers with the installed omo, claude");
		expect(declined.register).toEqual([]);
	});

	it("offers removal and unregistering once there is something to remove", async () => {
		const settings = { ...DEFAULT_SETTINGS, allowedApps: ["com.apple.TextEdit"], clients: ["omo"] as const };
		const session = scripted(["", "all", "attended", "", "", "", "omo"]);

		const change = await askForChanges(settings, session.ask, session.say);

		expect(change).toMatchObject({ allow: [], disallow: ["all"], delivery: "attended", unregister: ["omo"] });
	});
});

describe("#given client names #when they are parsed #then unknown names are refused", () => {
	it("accepts the four clients and names the one it does not know", () => {
		expect(parseClients(" omo, codex ,json,claude")).toEqual(["omo", "codex", "json", "claude"]);
		expect(() => parseClients("omo,windsurf")).toThrow(/unknown MCP client windsurf/);
	});
});

describe("#given cursor motion flags #when the config change is built #then they validate against the saved motion", () => {
	const saved = { ...DEFAULT_SETTINGS, cursorMotion: SAVED_MOTION };

	it("clears saved motion when Commander parses the required off option", () => {
		const program = new Command();
		registerLifecycleCommands(program, { isJsonOutput: () => false });
		const config = program.commands.find((command) => command.name() === "config");
		if (config === undefined) {
			throw new Error("Expected the config command");
		}
		config.parseOptions(["--cursor-motion", "off"]);
		const change = requestedChange(config.opts<{ cursorMotion?: CursorMotionConfig | "off" | null }>(), saved);
		if (change === undefined) {
			throw new Error("Expected a disable change");
		}

		expect(changeSettings(saved, change, () => undefined).settings.cursorMotion).toBeUndefined();
	});

	it("enables a style, and null disables it", () => {
		expect(requestedChange({ cursorMotion: { style: "classic" } }, DEFAULT_SETTINGS)?.cursorMotion).toEqual({
			style: "classic",
		});
		expect(requestedChange({ cursorMotion: null }, saved)?.cursorMotion).toBeNull();
		expect(requestedChange({}, saved)).toBeUndefined();
	});

	it("applies timing and duration to a newly selected or already saved style", () => {
		expect(
			requestedChange(
				{ cursorMotion: { style: "classic" }, cursorMotionTiming: "fixed", cursorMotionDuration: 250 },
				DEFAULT_SETTINGS,
			)?.cursorMotion,
		).toEqual({ style: "classic", timing: "fixed", glideDurationMs: 250 });
		expect(requestedChange({ cursorMotionDuration: 400 }, saved)?.cursorMotion).toEqual({
			...SAVED_MOTION,
			glideDurationMs: 400,
		});
	});

	it("rejects timing or duration without an enabled style, and an out-of-range duration", () => {
		expect(() => requestedChange({ cursorMotionTiming: "fixed" }, DEFAULT_SETTINGS)).toThrow(/enabled cursor motion/);
		expect(() => requestedChange({ cursorMotion: null, cursorMotionDuration: 100 }, saved)).toThrow(
			/enabled cursor motion/,
		);
		expect(() => requestedChange({ cursorMotionDuration: 9000 }, saved)).toThrow(/glideDurationMs/);
	});
});

describe("#given saved and environment cursor motion #when the low-level commands resolve it #then the environment wins", () => {
	it("reads the saved motion unless APPLE_CUA_CURSOR_MOTION is set, where off disables", () => {
		const directory = mkdtempSync(join(tmpdir(), "apple-cua-motion-"));
		try {
			const configPath = join(directory, "config.json");
			expect(resolveCursorMotion(configPath, {})).toBeNull();
			saveSettings(configPath, { ...DEFAULT_SETTINGS, cursorMotion: SAVED_MOTION });
			expect(resolveCursorMotion(configPath, {})).toEqual(SAVED_MOTION);
			expect(resolveCursorMotion(configPath, { APPLE_CUA_CURSOR_MOTION: "" })).toBeNull();
			expect(resolveCursorMotion(configPath, { APPLE_CUA_CURSOR_MOTION: "off" })).toBeNull();
			expect(resolveCursorMotion(configPath, { APPLE_CUA_CURSOR_MOTION: "classic" })).toEqual({ style: "classic" });
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});

describe("#given a permission wait #when text arrives on the terminal #then only an explicit s skips it", () => {
	it("ignores bare Enters already waiting in the terminal and skips on s or skip", () => {
		expect(asksToSkip("\n")).toBe(false);
		expect(asksToSkip("\r\n\n\n")).toBe(false);
		expect(asksToSkip("y\n")).toBe(false);
		expect(asksToSkip("\ns\n")).toBe(true);
		expect(asksToSkip(" Skip \r")).toBe(true);
	});
});

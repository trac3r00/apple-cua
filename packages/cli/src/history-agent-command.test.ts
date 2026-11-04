import { describe, expect, it } from "bun:test";
import { skillDescriptionCommand } from "./history-agent.js";

describe("#given the skill description step #when its command is chosen #then a small model runs without tools", () => {
	it("uses Claude Code with haiku and one turn when it is installed", () => {
		const command = skillDescriptionCommand({}, (path) => path === "/home/me/.local/bin/claude", "/home/me");
		expect(command).toEqual({
			executable: "/home/me/.local/bin/claude",
			args: ["-p", "--model", "haiku", "--max-turns", "1", "--output-format", "text"],
		});
	});

	it("falls back to omo with the same model and honors both overrides", () => {
		const omo = skillDescriptionCommand({ OPENCUA_HISTORY_AGENT: "/opt/omo" }, () => false, "/home/me");
		expect(omo.executable).toBe("/opt/omo");
		expect(omo.args.slice(-3)).toEqual(["--model", "haiku", "-"]);
		expect(omo.args).toContain("--no-tools");
		const custom = skillDescriptionCommand(
			{ OPENCUA_HISTORY_MODEL: "sonnet" },
			(path) => path.endsWith("claude"),
			"/h",
		);
		expect(custom.args).toContain("sonnet");
	});
});

import { describe, expect, it } from "vitest";
import { askForChanges, parseClients } from "./lifecycle-commands.js";
import { DEFAULT_SETTINGS } from "./settings.js";

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
		const session = scripted(["TextEdit, com.apple.finder", "", "lean", "maybe", "on", "omo,cursor", "omo,codex"]);

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
		expect(session.said.some((line) => line.includes("unknown MCP client cursor"))).toBe(true);
		expect(session.questions.some((question) => question.startsWith("  Remove apps"))).toBe(false);
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
		expect(() => parseClients("omo,cursor")).toThrow(/unknown MCP client cursor/);
	});
});

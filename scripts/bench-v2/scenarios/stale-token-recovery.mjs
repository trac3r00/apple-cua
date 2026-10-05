import { TARGET } from "../fixture.mjs";

export const scenario = {
	id: "stale-token-recovery",
	fixture: "text",
	initial: "",
	steps: [
		{ op: "observe", app: "TextEdit" },
		{ op: "key", app: "TextEdit", value: "a", apple: "cmd+a", cua: "a", modifiers: ["cmd"] },
		{ op: "type", app: "TextEdit", value: TARGET },
		{ op: "move-window", app: "TextEdit" },
		{ op: "observe", app: "TextEdit" },
		{ op: "key", app: "TextEdit", value: "s", apple: "cmd+s", cua: "s", modifiers: ["cmd"] },
	],
	oracle: { kind: "file", expected: TARGET },
};

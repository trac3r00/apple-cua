import { TARGET } from "../fixture.mjs";

export const scenario = {
	id: "clipboard-copy",
	fixture: "text",
	initial: TARGET,
	steps: [
		{ op: "observe", app: "TextEdit" },
		{ op: "key", app: "TextEdit", value: "a", apple: "cmd+a", cua: "a", modifiers: ["cmd"] },
		{ op: "key", app: "TextEdit", value: "c", apple: "cmd+c", cua: "c", modifiers: ["cmd"] },
	],
	oracle: { kind: "clipboard", expected: TARGET },
};

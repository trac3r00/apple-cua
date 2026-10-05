import { TARGET } from "../fixture.mjs";

export const scenario = {
	id: "textedit-select-replace",
	fixture: "text",
	initial: "replace me",
	steps: [
		{ op: "observe", app: "TextEdit" },
		{ op: "key", app: "TextEdit", value: "a", apple: "cmd+a", cua: "a", modifiers: ["cmd"] },
		{ op: "type", app: "TextEdit", value: TARGET },
		{ op: "key", app: "TextEdit", value: "s", apple: "cmd+s", cua: "s", modifiers: ["cmd"] },
	],
	oracle: { kind: "file", expected: TARGET },
};

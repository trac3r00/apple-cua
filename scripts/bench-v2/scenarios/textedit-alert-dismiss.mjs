import { TARGET } from "../fixture.mjs";

export const scenario = {
	id: "textedit-alert-dismiss",
	fixture: "text",
	initial: "do not save",
	steps: [
		{ op: "observe", app: "TextEdit" },
		{ op: "key", app: "TextEdit", value: "a", apple: "cmd+a", cua: "a", modifiers: ["cmd"] },
		{ op: "type", app: "TextEdit", value: TARGET },
		{ op: "assert-text", app: "TextEdit", value: TARGET },
		{ op: "key", app: "TextEdit", value: "w", apple: "cmd+w", cua: "w", modifiers: ["cmd"] },
		{ op: "key", app: "TextEdit", value: "Escape", cua: "escape" },
	],
	oracle: { kind: "alert-dismiss" },
};

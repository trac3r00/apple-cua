export const scenario = {
	id: "textedit-undo",
	fixture: "text",
	initial: "original text",
	steps: [
		{ op: "observe", app: "TextEdit" },
		{ op: "key", app: "TextEdit", value: "a", apple: "cmd+a", cua: "a", modifiers: ["cmd"] },
		{ op: "type", app: "TextEdit", value: "temporary" },
		{ op: "assert-text", app: "TextEdit", value: "temporary" },
		{ op: "key", app: "TextEdit", value: "z", apple: "cmd+z", cua: "z", modifiers: ["cmd"] },
		{ op: "key", app: "TextEdit", value: "s", apple: "cmd+s", cua: "s", modifiers: ["cmd"] },
	],
	oracle: { kind: "file", expected: "original text" },
};

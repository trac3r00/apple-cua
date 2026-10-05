export const scenario = {
	id: "textedit-multiline",
	fixture: "text",
	initial: "",
	steps: [
		{ op: "observe", app: "TextEdit" },
		{ op: "key", app: "TextEdit", value: "a", apple: "cmd+a", cua: "a", modifiers: ["cmd"] },
		{ op: "type", app: "TextEdit", value: "first line\nsecond line" },
		{ op: "key", app: "TextEdit", value: "s", apple: "cmd+s", cua: "s", modifiers: ["cmd"] },
	],
	oracle: { kind: "file", expected: "first line\nsecond line" },
};

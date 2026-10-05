import { TARGET } from "../fixture.mjs";

export const scenario = {
	id: "textedit-two-windows",
	fixture: "two-docs",
	initial: "",
	steps: [
		{ op: "observe", app: "TextEdit", title: "document.txt" },
		{ op: "key", app: "TextEdit", title: "document.txt", value: "a", apple: "cmd+a", cua: "a", modifiers: ["cmd"] },
		{ op: "type", app: "TextEdit", title: "document.txt", value: TARGET },
		{ op: "key", app: "TextEdit", title: "document.txt", value: "s", apple: "cmd+s", cua: "s", modifiers: ["cmd"] },
	],
	oracle: { kind: "two-docs", expected: TARGET },
};

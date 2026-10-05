import { TARGET } from "../fixture.mjs";

export const scenario = {
	id: "textedit-rich-bold",
	fixture: "rich",
	initial: "",
	steps: [
		{ op: "observe", app: "TextEdit" },
		{ op: "key", app: "TextEdit", value: "a", apple: "cmd+a", cua: "a", modifiers: ["cmd"] },
		{ op: "type", app: "TextEdit", value: TARGET },
		// Bold applies to the selection; with nothing selected it only changes text typed next.
		{ op: "key", app: "TextEdit", value: "a", apple: "cmd+a", cua: "a", modifiers: ["cmd"] },
		{
			op: "menu",
			app: "TextEdit",
			path: ["Format", "Font", "Bold"],
			keyboard: [{ value: "b", apple: "cmd+b", cua: "b", modifiers: ["cmd"] }],
		},
		{ op: "key", app: "TextEdit", value: "s", apple: "cmd+s", cua: "s", modifiers: ["cmd"] },
	],
	oracle: { kind: "rich-bold" },
};

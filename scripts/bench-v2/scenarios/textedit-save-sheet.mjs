import { ROOT, TARGET } from "../fixture.mjs";

export const scenario = {
	id: "textedit-save-sheet",
	fixture: "text",
	initial: "",
	steps: [
		{ op: "observe", app: "TextEdit" },
		{ op: "key", app: "TextEdit", value: "n", apple: "cmd+n", cua: "n", modifiers: ["cmd"] },
		{ op: "observe", app: "TextEdit", title: "Untitled" },
		// New documents are rich text by default; the oracle reads a plain .txt file, so convert the
		// empty document first (an empty one converts without a confirmation alert).
		{
			op: "key",
			app: "TextEdit",
			title: "Untitled",
			value: "t",
			apple: "shift+cmd+t",
			cua: "t",
			modifiers: ["shift", "cmd"],
		},
		{ op: "type", app: "TextEdit", title: "Untitled", value: TARGET },
		{ op: "key", app: "TextEdit", title: "Untitled", value: "s", apple: "cmd+s", cua: "s", modifiers: ["cmd"] },
		// The Save sheet's name field does not take a path, so choose the folder with Go to Folder first.
		{ op: "key", app: "TextEdit", value: "g", apple: "shift+cmd+g", cua: "g", modifiers: ["shift", "cmd"] },
		{ op: "type", app: "TextEdit", value: ROOT },
		{ op: "key", app: "TextEdit", value: "Return", cua: "return" },
		{ op: "key", app: "TextEdit", value: "a", apple: "cmd+a", cua: "a", modifiers: ["cmd"] },
		// The name field keeps the ".txt" extension and Cmd+A selects only the name before it, so the
		// name is typed without the extension, as a person would.
		{ op: "type", app: "TextEdit", value: "saved-from-sheet" },
		{ op: "key", app: "TextEdit", value: "Return", cua: "return" },
	],
	oracle: { kind: "save-sheet", expected: TARGET },
};

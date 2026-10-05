export const scenario = {
	id: "finder-rename-file",
	fixture: "finder",
	initial: "",
	steps: [
		{ op: "observe", app: "Finder" },
		{
			op: "click-label",
			app: "Finder",
			value: "document.txt",
			// Typing a name in a Finder window selects the matching item.
			keyboard: [{ op: "type", value: "document.txt" }],
		},
		{ op: "key", app: "Finder", value: "Return", cua: "return" },
		// Finder's name editor selects the name without its extension; select the whole name so the
		// typed "renamed.txt" replaces "document.txt" rather than producing "renamed.txt.txt".
		{ op: "key", app: "Finder", value: "a", apple: "cmd+a", cua: "a", modifiers: ["cmd"] },
		{ op: "type", app: "Finder", value: "renamed.txt" },
		{ op: "key", app: "Finder", value: "Return", cua: "return" },
	],
	oracle: { kind: "finder-name", expected: "renamed.txt" },
};

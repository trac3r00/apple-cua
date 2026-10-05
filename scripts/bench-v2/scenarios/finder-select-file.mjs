export const scenario = {
	id: "finder-select-file",
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
	],
	oracle: { kind: "finder-selected", expected: "document.txt" },
};

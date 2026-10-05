export const scenario = {
	id: "finder-create-folder",
	fixture: "finder",
	initial: "",
	steps: [
		{ op: "observe", app: "Finder" },
		{ op: "key", app: "Finder", value: "n", apple: "shift+cmd+n", cua: "n", modifiers: ["shift", "cmd"] },
		{ op: "type", app: "Finder", value: "bench-folder" },
		{ op: "key", app: "Finder", value: "Return", cua: "return" },
	],
	oracle: { kind: "finder-name", expected: "bench-folder" },
};

export const scenario = {
	id: "settings-version",
	fixture: "settings",
	initial: "",
	steps: [
		{ op: "observe", app: "System Settings" },
		{
			op: "click-label",
			app: "System Settings",
			value: "General",
			// Settings search jumps straight to the About pane.
			keyboard: [
				{ value: "f", apple: "cmd+f", cua: "f", modifiers: ["cmd"] },
				{ op: "type", value: "About" },
				// The search results need a selection before Return opens one.
				{ value: "Down", cua: "down" },
				{ value: "Return", cua: "return" },
			],
		},
		{ op: "click-label", app: "System Settings", value: "About", keyboard: [] },
		{ op: "observe", app: "System Settings" },
	],
	oracle: { kind: "settings" },
};

import { TARGET } from "../fixture.mjs";

export const scenario = {
	id: "clipboard-cross-app",
	fixture: "cross-app",
	initial: TARGET,
	steps: [
		{ op: "observe", app: "TextEdit" },
		{ op: "key", app: "TextEdit", value: "a", apple: "cmd+a", cua: "a", modifiers: ["cmd"] },
		{ op: "key", app: "TextEdit", value: "c", apple: "cmd+c", cua: "c", modifiers: ["cmd"] },
		{ op: "observe", app: "Safari" },
		{ op: "click-label", app: "Safari", value: "Code" },
		{ op: "key", app: "Safari", value: "v", apple: "cmd+v", cua: "v", modifiers: ["cmd"] },
	],
	oracle: { kind: "safari-field", expected: TARGET },
};

import { ROOT, TARGET } from "../fixture.mjs";

export const scenario = {
	id: "two-apps-one-task",
	fixture: "text",
	initial: "",
	steps: [
		{ op: "observe", app: "TextEdit" },
		{ op: "key", app: "TextEdit", value: "a", apple: "cmd+a", cua: "a", modifiers: ["cmd"] },
		{ op: "type", app: "TextEdit", value: TARGET },
		{ op: "key", app: "TextEdit", value: "s", apple: "cmd+s", cua: "s", modifiers: ["cmd"] },
		{ op: "observe", app: "Finder", title: "start" },
		{ op: "key", app: "Finder", value: "g", apple: "shift+cmd+g", cua: "g", modifiers: ["shift", "cmd"] },
		{ op: "type", app: "Finder", value: ROOT },
		{ op: "key", app: "Finder", value: "Return", cua: "return" },
	],
	oracle: { kind: "two-apps", expected: TARGET },
};

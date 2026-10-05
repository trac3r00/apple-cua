import { PAGE, TARGET } from "../fixture.mjs";

export const scenario = {
	id: "safari-form",
	fixture: "safari",
	initial: "",
	steps: [
		{ op: "observe", app: "Safari" },
		{ op: "key", app: "Safari", value: "l", apple: "cmd+l", cua: "l", modifiers: ["cmd"] },
		{ op: "type", app: "Safari", value: `file://${PAGE}` },
		{ op: "key", app: "Safari", value: "Return", cua: "return" },
		{ op: "click-label", app: "Safari", value: "Code" },
		{ op: "type", app: "Safari", value: TARGET },
	],
	oracle: { kind: "safari-field", expected: TARGET },
};

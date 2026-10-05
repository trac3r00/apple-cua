import { PAGE } from "../fixture.mjs";

export const scenario = {
	id: "safari-link",
	fixture: "safari",
	initial: "",
	steps: [
		{ op: "observe", app: "Safari" },
		{ op: "key", app: "Safari", value: "l", apple: "cmd+l", cua: "l", modifiers: ["cmd"] },
		{ op: "type", app: "Safari", value: `file://${PAGE}` },
		{ op: "key", app: "Safari", value: "Return", cua: "return" },
		{ op: "click-label", app: "Safari", value: "Destination" },
	],
	oracle: { kind: "safari-link" },
};

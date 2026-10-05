import { ROOT } from "../fixture.mjs";

export const scenario = {
	id: "finder-navigate",
	fixture: "finder",
	initial: "",
	steps: [
		{ op: "observe", app: "Finder", title: "start" },
		{ op: "key", app: "Finder", value: "g", apple: "shift+cmd+g", cua: "g", modifiers: ["shift", "cmd"] },
		{ op: "type", app: "Finder", value: ROOT },
		{ op: "key", app: "Finder", value: "Return", cua: "return" },
	],
	oracle: { kind: "finder-path", expected: `${ROOT}/` },
};

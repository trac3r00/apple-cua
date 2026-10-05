export const scenario = {
	id: "calculator-add",
	fixture: "calculator",
	initial: "",
	steps: [
		{ op: "observe", app: "Calculator" },
		{ op: "key", app: "Calculator", value: "2" },
		{ op: "key", app: "Calculator", value: "+" },
		{ op: "key", app: "Calculator", value: "3" },
		{ op: "key", app: "Calculator", value: "=" },
		{ op: "key", app: "Calculator", value: "c", apple: "cmd+c", cua: "c", modifiers: ["cmd"] },
	],
	oracle: { kind: "calculator", expected: "5" },
};

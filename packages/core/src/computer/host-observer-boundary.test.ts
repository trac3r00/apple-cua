import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import { HostInteractionDenied, denyHostInteraction } from "./host-interaction-policy.js";

// Evaluate the actual class, but not its imports or module initializers. Every dependency
// capable of desktop input is absent or replaced with a counter. This test cannot load FFI.
const source = ts.createSourceFile(
	"macos.ts",
	readFileSync(new URL("../platform/macos.ts", import.meta.url), "utf8"),
	ts.ScriptTarget.ES2022,
	true,
);
const declaration = source.statements.find(
	(statement): statement is ts.ClassDeclaration =>
		ts.isClassDeclaration(statement) && statement.name?.text === "MacOSHostComputer",
);
if (declaration === undefined) throw new Error("Missing MacOSHostComputer class");
const compiled = ts.transpileModule(declaration.getText(source), {
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture() {
	const exports: Record<string, unknown> = {};
	let effects = 0;
	let controllers = 0;
	const effect = () => {
		effects++;
	};
	runInNewContext(
		compiled,
		{
			exports,
			HostComputer: Object,
			InputLock: class {
				run = effect;
			},
			MacOSInputController: class {
				constructor() {
					controllers++;
				}
				move = effect;
				click = effect;
				typeText = effect;
				setMode = effect;
			},
			denyHostInteraction,
			cursorMotionFromEnvironment: () => undefined,
			NOOP_POINTER_OVERLAY: { highlight: effect, set: effect },
			NOOP_DISPLAY_SLEEP: {},
			isScreenLocked: () => false,
		},
		{ timeout: 5_000 },
	);
	const hostConstructor = exports["MacOSHostComputer"];
	if (typeof hostConstructor !== "function") throw new Error("Missing host constructor");
	const instance: unknown = Reflect.construct(hostConstructor, []);
	if (typeof instance !== "object" || instance === null) throw new Error("Missing host instance");
	return { hostConstructor, instance, effects: () => effects, controllers: () => controllers };
}

describe("#given the shared host #when input is requested #then it remains observation-only", () => {
	it("advertises no input or shared clipboard capability", () => {
		const { instance } = fixture();
		expect(Reflect.get(instance, "capabilities")).toEqual({
			supportsScreenshot: false,
			supportsInput: false,
			supportsAccessibility: true,
			supportsClipboard: false,
		});
		expect(Object.isFrozen(Reflect.get(instance, "capabilities"))).toBe(true);
	});

	it("rejects attended construction before creating an input controller", () => {
		const { hostConstructor, effects, controllers } = fixture();
		const built = controllers();
		expect(() => Reflect.construct(hostConstructor, [{ delivery: "attended" }])).toThrow(HostInteractionDenied);
		expect(controllers()).toBe(built);
		expect(effects()).toBe(0);
	});

	it.each([
		"screenshot",
		"move",
		"click",
		"rightClick",
		"middleClick",
		"doubleClick",
		"type",
		"key",
		"invokeMenu",
		"scroll",
		"drag",
		"getCursorPosition",
		"setValue",
		"selectText",
		"performAction",
		"pressAtPosition",
		"scrollElementIntoView",
		"showPointerAt",
		"typeIntoFocused",
	])("refuses %s before dispatching any input", async (method) => {
		const { instance, effects } = fixture();
		const dispatch: unknown = Reflect.get(instance, method);
		if (typeof dispatch !== "function") throw new Error(`Missing method: ${method}`);
		await expect(Promise.resolve().then(() => Reflect.apply(dispatch, instance, []))).rejects.toBeInstanceOf(
			HostInteractionDenied,
		);
		expect(effects()).toBe(0);
	});

	it("reports an isolation requirement before reading observation state", async () => {
		const { instance, effects } = fixture();
		const preflight: unknown = Reflect.get(instance, "preflightInput");
		if (typeof preflight !== "function") throw new Error("Missing preflightInput");
		await expect(Reflect.apply(preflight, instance, [])).resolves.toEqual({
			ok: false,
			reason: "isolated-session-required",
		});
		expect(effects()).toBe(0);
	});
});

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import { type HostInteraction, HostInteractionDenied, denyHostInteraction } from "./host-interaction-policy.js";

const operations: readonly HostInteraction[] = [
	"physical-pointer",
	"global-input",
	"host-focus",
	"host-clipboard",
	"host-spaces",
	"host-window",
	"host-overlay",
];

describe("#given the human desktop #when an interaction is requested #then it is refused", () => {
	it.each(operations)("refuses %s without an opt-in bypass", (operation) => {
		expect(() => denyHostInteraction(operation)).toThrow(HostInteractionDenied);
		try {
			denyHostInteraction(operation);
		} catch (error: unknown) {
			expect(error).toMatchObject({ code: "HOST_INTERACTION_FORBIDDEN", operation });
		}
	});
});

// Extract only reviewed wrapper functions. Never import either native module:
// no koffi, WindowServer, app, clipboard, process, or physical-input API is loaded.
const dispatchSources = new Map(
	[
		"coregraphics-bindings",
		"accessibility",
		"skylight",
		"workspace",
		"pasteboard",
		"../macos-window-frame",
		"cursor-overlay",
		"../macos-open-app",
		"../terminal-session",
	].map((module): readonly [string, ts.SourceFile] => [
		module,
		ts.createSourceFile(
			`${module}.ts`,
			readFileSync(new URL(`../platform/macos-ffi/${module}.ts`, import.meta.url), "utf8"),
			ts.ScriptTarget.ES2022,
			true,
		),
	]),
);

describe("#given native dispatch wrappers #when invoked in a fake-only context #then physical effects are denied", () => {
	it.each([
		{ module: "coregraphics-bindings", name: "postToHidEventTap" },
		{ module: "coregraphics-bindings", name: "warpCursorPosition" },
		{ module: "accessibility", name: "AXUIElementPerformAction" },
		{ module: "accessibility", name: "AXUIElementSetAttributeValue" },
		{ module: "skylight", name: "postMouseEventRecordToWindow" },
		{ module: "skylight", name: "SLEventPostToPid" },
		{ module: "skylight", name: "SLPSPostEventRecordTo" },
		{ module: "skylight", name: "CGEventPostToPSN" },
		{ module: "skylight", name: "activateWindowWithoutRaise" },
		{ module: "skylight", name: "setProcessAppActive" },
		{ module: "skylight", name: "beginFocusWithoutRaise" },
		{ module: "skylight", name: "restoreFrontProcessNoWindows" },
		{ module: "workspace", name: "activateApplication" },
	])("refuses every generated input to $name", ({ module, name }) => {
		const source = dispatchSources.get(module);
		if (source === undefined) throw new Error(`Missing source: ${module}`);
		const declaration = source.statements.find(
			(statement): statement is ts.FunctionDeclaration =>
				ts.isFunctionDeclaration(statement) && statement.name?.text === name,
		);
		if (declaration === undefined) throw new Error(`Missing dispatch wrapper: ${name}`);
		const compiled = ts.transpileModule(`${declaration.getText(source)}\nexports["${name}"] = ${name};`, {
			compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
		}).outputText;
		const exports: Record<string, unknown> = {};
		let nativeEffects = 0;
		runInNewContext(
			compiled,
			{
				exports,
				denyHostInteraction,
				CGEventPost: () => nativeEffects++,
				CGWarpMouseCursorPosition: () => nativeEffects++,
				Buffer,
				K_CPS_NO_WINDOWS: 0x400,
				K_CPS_USER_GENERATED: 0x200,
				_SLPSGetFrontProcess: () => 0,
				frontProcessSerialNumber: () => Buffer.alloc(8),
				processSerialNumberForWindow: () => Buffer.alloc(8),
				buildMouseEventRecord: () => Buffer.alloc(248),
				SLPSSetFrontProcessWithOptions: () => nativeEffects++,
				SLPSPostEventRecordTo: () => {
					nativeEffects++;
					return 0;
				},
			},
			{ timeout: 100 },
		);
		const dispatch = exports[name];
		if (typeof dispatch !== "function") throw new Error(`Wrapper was not exported: ${name}`);
		const inputs: readonly unknown[] = [
			undefined,
			null,
			{},
			{ x: 0, y: 0 },
			{ x: -1, y: 1 },
			{ x: Number.NaN, y: Number.POSITIVE_INFINITY },
		];
		for (const input of inputs) {
			expect(() => dispatch(input)).toThrow(HostInteractionDenied);
			expect(nativeEffects).toBe(0);
		}
	});

	it("rejects a deliberately unsafe fake implementation during oracle calibration", () => {
		let fakeEffects = 0;
		const unsafe = () => fakeEffects++;
		const assertDenied = (dispatch: () => unknown) => {
			expect(dispatch).toThrow(HostInteractionDenied);
			expect(fakeEffects).toBe(0);
		};
		expect(() => assertDenied(unsafe)).toThrow();
		expect(fakeEffects).toBe(1);
	});
});

describe("#given shared-host resource defaults #when used #then no native resource is touched", () => {
	it.each([
		{ module: "../macos-open-app", name: "spawnOpenLauncher", args: [], method: "launch" },
		{ module: "../terminal-session", name: "createTerminalSession", args: [], method: "runCommand" },
		{ module: "cursor-overlay", name: "createCursorOverlay", args: [] },
		{ module: "cursor-overlay", name: "defaultSocketTransport", args: [Date.now, () => undefined] },
		{ module: "pasteboard", name: "readClipboard", args: [] },
		{ module: "pasteboard", name: "writeClipboard", args: [{ type: "text", text: "synthetic" }] },
		{
			module: "../macos-window-frame",
			name: "setWindowFrame",
			args: [123, 99, { x: 0, y: 0, width: 100, height: 100 }],
		},
	])("refuses the native default for $name", async (testCase) => {
		const { module, name, args } = testCase;
		const source = dispatchSources.get(module);
		if (source === undefined) throw new Error(`Missing source: ${module}`);
		const declaration = source.statements.find(
			(statement): statement is ts.FunctionDeclaration =>
				ts.isFunctionDeclaration(statement) && statement.name?.text === name,
		);
		if (declaration === undefined) throw new Error(`Missing resource wrapper: ${name}`);
		const compiled = ts.transpileModule(declaration.getText(source), {
			compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
		}).outputText;
		const exports: Record<string, unknown> = {};
		let nativeCalls = 0;
		runInNewContext(
			compiled,
			{
				exports,
				denyHostInteraction,
				spawn: () => nativeCalls++,
				connect: () => nativeCalls++,
				cursorOverlaySocketPath: () => "/synthetic/host-overlay.sock",
				validateFrame: () => undefined,
				prepareClipboardInput: (input: unknown) => input,
				activateApplication: () => nativeCalls++,
				nativeAccess: {
					find: () => nativeCalls++,
					run: () => nativeCalls++,
				},
				nativePasteboard: {
					types: () => {
						nativeCalls++;
						return [];
					},
					clear: () => nativeCalls++,
				},
				nativeWindowFrameDependencies: {
					windowFrames: async () => {
						nativeCalls++;
						return [];
					},
				},
			},
			{ timeout: 100 },
		);
		const dispatch = exports[name];
		if (typeof dispatch !== "function") throw new Error(`Wrapper was not exported: ${name}`);
		await expect(
			Promise.resolve().then(() => {
				const result: unknown = dispatch(...args);
				if ("method" in testCase && testCase.method !== undefined) {
					if (typeof result !== "object" || result === null) throw new Error("Missing resource");
					const method: unknown = Reflect.get(result, testCase.method);
					if (typeof method !== "function") throw new Error("Missing resource method");
					return Reflect.apply(method, result, []);
				}
				return result;
			}),
		).rejects.toBeInstanceOf(HostInteractionDenied);
		expect(nativeCalls).toBe(0);
	});
});

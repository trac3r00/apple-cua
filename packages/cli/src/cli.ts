#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { MacOSHostComputer } from "@macos-cua/core";
import type { ComputerInterface, KeyOptions, ScreenshotOptions, ScrollOptions } from "@macos-cua/core";
import { Command } from "commander";

type PackageJson = {
	version: string;
};

type GlobalOptions = {
	json?: boolean;
	targetPid?: number;
	targetBundleId?: string;
};

type MouseButton = "left" | "right" | "middle";
type PermissionKind = "screen" | "accessibility" | "input-monitoring" | "apple-events";
type PermissionStatus = "authorized" | "denied" | "not-determined" | "restricted" | "unknown";
type KeyModifier = NonNullable<KeyOptions["modifiers"]>[number];
type Constructor = new () => unknown;

type PermissionController = {
	check(kind: PermissionKind): PermissionStatus | Promise<PermissionStatus>;
	request(kind: PermissionKind): undefined | Promise<undefined>;
};

type ScreenshotCommandOptions = {
	output: string;
	region?: string;
	format: "png" | "jpeg";
	quality: number;
};

type PointCommandOptions = {
	x?: number;
	y?: number;
};

type ClickCommandOptions = PointCommandOptions & {
	button: MouseButton;
};

type DragCommandOptions = {
	fromX?: number;
	fromY?: number;
	toX?: number;
	toY?: number;
	duration: number;
};

type ScrollCommandOptions = {
	direction: ScrollOptions["direction"];
	amount: number;
};

type KeyCommandOptions = {
	modifiers?: string;
};

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const packageJson: PackageJson = readPackageJson();
const program = new Command();

program
	.name("macos-cua")
	.description("Native macOS computer-use control. Per-PID mouse/scroll uses the Swift cua-helper SkyLight bridge.")
	.version(packageJson.version)
	.option("--json", "print machine-readable JSON output")
	.option(
		"--target-pid <pid>",
		"deliver input to a target process id without focusing it (requires built cua-helper for mouse/scroll)",
		parsePositiveInteger,
	)
	.option("--target-bundle-id <id>", "deliver input to the running app with this bundle identifier");

program
	.command("screenshot")
	.description("Take a screenshot")
	.option("-o, --output <path>", "output file path", "./screenshot.png")
	.option("-r, --region <x,y,w,h>", "screenshot region as x,y,width,height")
	.option("-f, --format <format>", "image format: png or jpeg", parseScreenshotFormat, "png")
	.option("-q, --quality <n>", "JPEG quality from 1 to 100", parseQuality, 95)
	.action(async (options: ScreenshotCommandOptions) => {
		await withComputer(async (computer) => {
			const screenshotOptions: ScreenshotOptions = {
				format: options.format,
				quality: options.quality,
				...(options.region === undefined ? {} : { region: parseRegion(options.region) }),
			};
			const result = await computer.screenshot(screenshotOptions);
			writeFileSync(options.output, result.data);
			writeOutput(
				{
					ok: true,
					action: "screenshot",
					args: {
						output: options.output,
						format: options.format,
						quality: options.quality,
						...(options.region === undefined ? {} : { region: parseRegion(options.region) }),
					},
					output: options.output,
					mimeType: result.mimeType,
					width: result.width,
					height: result.height,
				},
				`Screenshot saved to ${options.output} (${result.mimeType}, ${result.width}x${result.height})`,
			);
		});
	});

program
	.command("click")
	.description("Click. With --target-pid, posts through cua-helper without cursor movement or focus steal.")
	.argument("[x]", "x coordinate")
	.argument("[y]", "y coordinate")
	.option("-x, --x <x>", "x coordinate", parseXCoordinate)
	.option("-y, --y <y>", "y coordinate", parseYCoordinate)
	.option("-b, --button <button>", "mouse button: left, right, or middle", parseMouseButton, "left")
	.action(async (x: string | undefined, y: string | undefined, options: ClickCommandOptions) => {
		const position = parsePointArguments(x, y, options);
		await withComputer((computer) => clickWithButton(computer, position, options.button));
		writeActionOutput(
			"click",
			{ ...position, button: options.button },
			`Clicked ${options.button} at ${position.x},${position.y}`,
		);
	});

program
	.command("right-click")
	.description("Right-click. With --target-pid, posts through cua-helper without cursor movement or focus steal.")
	.argument("[x]", "x coordinate")
	.argument("[y]", "y coordinate")
	.option("-x, --x <x>", "x coordinate", parseXCoordinate)
	.option("-y, --y <y>", "y coordinate", parseYCoordinate)
	.action(async (x: string | undefined, y: string | undefined, options: PointCommandOptions) => {
		const position = parsePointArguments(x, y, options);
		await withComputer((computer) => computer.rightClick(position));
		writeActionOutput("right-click", position, `Right-clicked at ${position.x},${position.y}`);
	});

program
	.command("middle-click")
	.description("Middle-click. With --target-pid, posts through cua-helper without cursor movement or focus steal.")
	.argument("[x]", "x coordinate")
	.argument("[y]", "y coordinate")
	.option("-x, --x <x>", "x coordinate", parseXCoordinate)
	.option("-y, --y <y>", "y coordinate", parseYCoordinate)
	.action(async (x: string | undefined, y: string | undefined, options: PointCommandOptions) => {
		const position = parsePointArguments(x, y, options);
		await withComputer((computer) => computer.middleClick(position));
		writeActionOutput("middle-click", position, `Middle-clicked at ${position.x},${position.y}`);
	});

program
	.command("double-click")
	.description("Double-click. With --target-pid, posts through cua-helper without cursor movement or focus steal.")
	.argument("[x]", "x coordinate")
	.argument("[y]", "y coordinate")
	.option("-x, --x <x>", "x coordinate", parseXCoordinate)
	.option("-y, --y <y>", "y coordinate", parseYCoordinate)
	.action(async (x: string | undefined, y: string | undefined, options: PointCommandOptions) => {
		const position = parsePointArguments(x, y, options);
		await withComputer((computer) => computer.doubleClick(position));
		writeActionOutput("double-click", position, `Double-clicked at ${position.x},${position.y}`);
	});

program
	.command("move")
	.description("Move cursor globally, or send mouseMoved to --target-pid without moving the real cursor.")
	.argument("[x]", "x coordinate")
	.argument("[y]", "y coordinate")
	.option("-x, --x <x>", "x coordinate", parseXCoordinate)
	.option("-y, --y <y>", "y coordinate", parseYCoordinate)
	.action(async (x: string | undefined, y: string | undefined, options: PointCommandOptions) => {
		const position = parsePointArguments(x, y, options);
		await withComputer((computer) => computer.move(position));
		writeActionOutput("move", position, `Moved cursor to ${position.x},${position.y}`);
	});

program
	.command("drag")
	.description("Drag. With --target-pid, posts through cua-helper without cursor movement or focus steal.")
	.argument("[fromX]", "start x coordinate")
	.argument("[fromY]", "start y coordinate")
	.argument("[toX]", "end x coordinate")
	.argument("[toY]", "end y coordinate")
	.option("--from-x <x>", "start x coordinate", parseXCoordinate)
	.option("--from-y <y>", "start y coordinate", parseYCoordinate)
	.option("--to-x <x>", "end x coordinate", parseXCoordinate)
	.option("--to-y <y>", "end y coordinate", parseYCoordinate)
	.option("-d, --duration <ms>", "duration in milliseconds", parseNonNegativeInteger, 500)
	.action(
		async (
			fromX: string | undefined,
			fromY: string | undefined,
			toX: string | undefined,
			toY: string | undefined,
			options: DragCommandOptions,
		) => {
			const args = parseDragArguments(fromX, fromY, toX, toY, options);
			await withComputer((computer) =>
				computer.drag({
					from: { x: args.fromX, y: args.fromY },
					to: { x: args.toX, y: args.toY },
					duration: args.duration,
				}),
			);
			writeActionOutput("drag", args, `Dragged from ${args.fromX},${args.fromY} to ${args.toX},${args.toY}`);
		},
	);

program
	.command("scroll")
	.description("Scroll globally with a wheel event, or scroll --target-pid via helper PageUp/PageDown/arrow keys.")
	.requiredOption("-d, --direction <direction>", "direction: up, down, left, or right", parseScrollDirection)
	.option("-a, --amount <n>", "scroll amount", parsePositiveInteger, 3)
	.action(async (options: ScrollCommandOptions) => {
		await withComputer((computer) => computer.scroll({ direction: options.direction, amount: options.amount }));
		writeActionOutput("scroll", options, `Scrolled ${options.direction} by ${options.amount}`);
	});

program
	.command("type")
	.description("Type text")
	.argument("<text...>", "text to type")
	.action(async (textParts: string[]) => {
		const text = textParts.join(" ");
		await withComputer((computer) => computer.type(text));
		writeActionOutput("type", { text }, `Typed: ${text}`);
	});

program
	.command("key")
	.description("Press key with optional modifiers")
	.argument("<key>", "key to press")
	.option("-m, --modifiers <csv>", "modifiers (comma-separated: cmd,alt,ctrl,shift)")
	.action(async (key: string, options: KeyCommandOptions) => {
		const modifiers = options.modifiers === undefined ? [] : parseModifiersCsv(options.modifiers);
		await withComputer((computer) => computer.key(key, { modifiers }));
		writeActionOutput("key", { key, modifiers }, `Pressed: ${formatKeyChord(key, modifiers)}`);
	});

program
	.command("keypress")
	.description("Press a key chord")
	.argument("<keys...>", "key chord, for example: cmd shift t")
	.action(async (keys: string[]) => {
		if (keys.length === 0) {
			throw new Error("keypress requires at least one key");
		}
		const key = keys[keys.length - 1];
		if (key === undefined) {
			throw new Error("keypress requires a key");
		}
		const modifiers = keys.slice(0, -1).map(parseModifier);
		await withComputer((computer) => computer.key(key, { modifiers }));
		writeActionOutput("keypress", { keys, key, modifiers }, `Pressed: ${formatKeyChord(key, modifiers)}`);
	});

program
	.command("wait")
	.description("Sleep for N milliseconds")
	.argument("<ms>", "milliseconds to wait")
	.action(async (milliseconds: string) => {
		const duration = parseNonNegativeInteger(milliseconds);
		await sleep(duration);
		writeActionOutput("wait", { milliseconds: duration }, `Waited ${duration}ms`);
	});

program
	.command("cursor")
	.description("Get cursor position")
	.action(async () => {
		await withComputer(async (computer) => {
			const position = await computer.getCursorPosition();
			writeOutput(position, `${position.x},${position.y}`);
		});
	});

program
	.command("screen")
	.description("Get screen size")
	.action(async () => {
		await withComputer(async (computer) => {
			const size = await computer.getScreenSize();
			writeOutput(size, `${size.width}x${size.height}`);
		});
	});

const permissionsCommand = program.command("permissions").description("Manage macOS permissions");

permissionsCommand
	.command("check")
	.description("Check a macOS permission status")
	.argument("<kind>", "permission kind: screen, accessibility, input-monitoring, or apple-events", parsePermissionKind)
	.action(async (kind: PermissionKind) => {
		const permissions = await loadPermissions();
		const status = permissions === null ? "unknown" : await permissions.check(kind);
		writeOutput(status, status);
	});

permissionsCommand
	.command("request")
	.description("Trigger a macOS permission dialog")
	.argument("<kind>", "permission kind: screen, accessibility, input-monitoring, or apple-events", parsePermissionKind)
	.action(async (kind: PermissionKind) => {
		const permissions = await loadPermissions();
		if (permissions === null) {
			throw new Error("MacOSPermissions is not available in @macos-cua/core yet");
		}
		await permissions.request(kind);
		writeOutput({ ok: true, kind }, `Requested ${kind} permission`);
	});

const windowsCommand = program.command("windows").description("Inspect macOS windows");

windowsCommand
	.command("active")
	.description("Print active window")
	.action(async () => {
		const windows = await loadWindows();
		const activeWindow = await callFirstMethod(windows, ["active", "getActiveWindow", "activeWindow"]);
		writeOutput(activeWindow, formatUnknown(activeWindow));
	});

windowsCommand
	.command("list")
	.description("Print all windows")
	.action(async () => {
		const windows = await loadWindows();
		const windowList = await callFirstMethod(windows, ["list", "listWindows", "all"]);
		writeOutput(windowList, formatUnknown(windowList));
	});

await program.parseAsync().catch(handleError);

function readPackageJson(): PackageJson {
	const parsed: { version: string } = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8")) as {
		version: string;
	};
	if (typeof parsed.version !== "string") {
		throw new Error("Invalid package.json: version must be a string");
	}
	return parsed;
}

async function withComputer(action: (computer: MacOSHostComputer) => Promise<void>): Promise<void> {
	const computer = new MacOSHostComputer();
	try {
		const targetPid = await resolveTargetPid();
		computer.setTarget(targetPid);
		await action(computer);
	} finally {
		await computer.close();
	}
}

async function clickWithButton(
	computer: ComputerInterface,
	position: { x: number; y: number },
	button: MouseButton,
): Promise<void> {
	switch (button) {
		case "left":
			await computer.click(position);
			return;
		case "right":
			await computer.rightClick(position);
			return;
		case "middle":
			await computer.middleClick(position);
			return;
	}
}

async function resolveTargetPid(): Promise<number | undefined> {
	const options = program.opts<GlobalOptions>();
	if (options.targetPid !== undefined && options.targetBundleId !== undefined) {
		throw new Error("Use only one of --target-pid or --target-bundle-id");
	}
	if (options.targetPid !== undefined) {
		return options.targetPid;
	}
	if (options.targetBundleId !== undefined) {
		return resolvePidForBundleId(options.targetBundleId);
	}
	return undefined;
}

async function resolvePidForBundleId(bundleId: string): Promise<number> {
	const script = `tell application "System Events" to get unix id of first process whose bundle identifier is ${toAppleScriptString(bundleId)}`;
	const { stdout } = await execFileAsync("osascript", ["-e", script], { encoding: "utf8" });
	return parsePositiveInteger(stdout.trim());
}

function toAppleScriptString(value: string): string {
	return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function parseInteger(value: string, name: string): number {
	const number = Number.parseInt(value, 10);
	if (!Number.isSafeInteger(number)) {
		throw new Error(`${name} must be an integer`);
	}
	return number;
}

function parseXCoordinate(value: string): number {
	return parseInteger(value, "x");
}

function parseYCoordinate(value: string): number {
	return parseInteger(value, "y");
}

function parsePointArguments(
	xArgument: string | undefined,
	yArgument: string | undefined,
	options: PointCommandOptions,
): { x: number; y: number } {
	const x = options.x ?? (xArgument === undefined ? undefined : parseInteger(xArgument, "x"));
	const y = options.y ?? (yArgument === undefined ? undefined : parseInteger(yArgument, "y"));
	if (x === undefined || y === undefined) {
		throw new Error("x and y are required (pass positional coordinates or --x/--y)");
	}
	return { x, y };
}

function parseDragArguments(
	fromXArgument: string | undefined,
	fromYArgument: string | undefined,
	toXArgument: string | undefined,
	toYArgument: string | undefined,
	options: DragCommandOptions,
): { fromX: number; fromY: number; toX: number; toY: number; duration: number } {
	const fromX = options.fromX ?? (fromXArgument === undefined ? undefined : parseInteger(fromXArgument, "fromX"));
	const fromY = options.fromY ?? (fromYArgument === undefined ? undefined : parseInteger(fromYArgument, "fromY"));
	const toX = options.toX ?? (toXArgument === undefined ? undefined : parseInteger(toXArgument, "toX"));
	const toY = options.toY ?? (toYArgument === undefined ? undefined : parseInteger(toYArgument, "toY"));
	if (fromX === undefined || fromY === undefined || toX === undefined || toY === undefined) {
		throw new Error(
			"fromX, fromY, toX, and toY are required (pass positional coordinates or --from-x/--from-y/--to-x/--to-y)",
		);
	}
	return { fromX, fromY, toX, toY, duration: options.duration };
}

function parseNonNegativeInteger(value: string): number {
	const number = parseInteger(value, "value");
	if (number < 0) {
		throw new Error("value must be non-negative");
	}
	return number;
}

function parsePositiveInteger(value: string): number {
	const number = parseInteger(value, "value");
	if (number <= 0) {
		throw new Error("value must be positive");
	}
	return number;
}

function parseQuality(value: string): number {
	const quality = parsePositiveInteger(value);
	if (quality > 100) {
		throw new Error("quality must be between 1 and 100");
	}
	return quality;
}

function parseRegion(value: string): NonNullable<ScreenshotOptions["region"]> {
	const parts = value.split(",").map((part) => parseInteger(part.trim(), "region value"));
	const [x, y, width, height] = parts;
	if (parts.length !== 4 || x === undefined || y === undefined || width === undefined || height === undefined) {
		throw new Error("region must be x,y,width,height");
	}
	return { x, y, width, height };
}

function parseScreenshotFormat(value: string): ScreenshotOptions["format"] {
	if (value === "png" || value === "jpeg") {
		return value;
	}
	throw new Error("format must be png or jpeg");
}

function parseMouseButton(value: string): MouseButton {
	if (value === "left" || value === "right" || value === "middle") {
		return value;
	}
	throw new Error("button must be left, right, or middle");
}

function parseScrollDirection(value: string): ScrollOptions["direction"] {
	if (value === "up" || value === "down" || value === "left" || value === "right") {
		return value;
	}
	throw new Error("direction must be up, down, left, or right");
}

function parsePermissionKind(value: string): PermissionKind {
	if (value === "screen" || value === "accessibility" || value === "input-monitoring" || value === "apple-events") {
		return value;
	}
	throw new Error("permission kind must be screen, accessibility, input-monitoring, or apple-events");
}

function parseModifiersCsv(value: string): KeyModifier[] {
	if (value.trim() === "") {
		return [];
	}
	return value.split(",").map((modifier) => parseModifier(modifier.trim()));
}

function parseModifier(value: string): KeyModifier {
	switch (value) {
		case "cmd":
		case "command":
			return "command";
		case "alt":
		case "option":
			return "option";
		case "ctrl":
		case "control":
			return "control";
		case "shift":
			return "shift";
		default:
			throw new Error(`unsupported modifier: ${value}`);
	}
}

function formatKeyChord(key: string, modifiers: KeyModifier[]): string {
	return modifiers.length === 0 ? key : `${modifiers.join("+")}+${key}`;
}

function isJsonOutput(): boolean {
	return program.opts<GlobalOptions>().json === true;
}

function writeOutput(jsonValue: unknown, humanValue: string): void {
	if (isJsonOutput()) {
		process.stdout.write(`${JSON.stringify(jsonValue)}\n`);
		return;
	}
	process.stdout.write(`${humanValue}\n`);
}

function writeActionOutput(action: string, args: Record<string, unknown>, humanValue: string): void {
	writeOutput({ ok: true, action, args }, humanValue);
}

async function loadPermissions(): Promise<PermissionController | null> {
	const permissionsConstructor = await loadOptionalConstructor("MacOSPermissions");
	if (permissionsConstructor === null) {
		return null;
	}
	const permissions = new permissionsConstructor();
	if (!hasPermissionController(permissions)) {
		throw new Error("MacOSPermissions does not implement check/request");
	}
	return permissions;
}

async function loadWindows(): Promise<unknown> {
	const windowsConstructor = await loadOptionalConstructor("MacOSWindows");
	if (windowsConstructor === null) {
		throw new Error("MacOSWindows is not available in @macos-cua/core yet");
	}
	return new windowsConstructor();
}

async function loadOptionalConstructor(exportName: string): Promise<Constructor | null> {
	const coreExports = Object.fromEntries(Object.entries(await import("@macos-cua/core")));
	const exportedValue = coreExports[exportName];
	return isConstructor(exportedValue) ? exportedValue : null;
}

function isConstructor(value: unknown): value is Constructor {
	return typeof value === "function";
}

function hasPermissionController(value: unknown): value is PermissionController {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const candidate = value as { check?: unknown; request?: unknown };
	return typeof candidate.check === "function" && typeof candidate.request === "function";
}

async function callFirstMethod(instance: unknown, methodNames: string[]): Promise<unknown> {
	if (typeof instance !== "object" || instance === null) {
		throw new Error("window controller is not an object");
	}
	const methods = instance as Record<string, unknown>;
	for (const methodName of methodNames) {
		const method = methods[methodName];
		if (typeof method === "function") {
			return await method.call(instance);
		}
	}
	throw new Error(`window controller is missing one of: ${methodNames.join(", ")}`);
}

function formatUnknown(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	return JSON.stringify(value, null, 2);
}

function handleError(error: unknown): never {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`${message}\n`);
	process.exit(1);
}

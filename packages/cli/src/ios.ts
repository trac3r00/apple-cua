import { writeFileSync } from "node:fs";
import {
	IPhoneMirroring,
	type MirroringSessionState,
	describeMirroringState,
	readImagePixelSize,
} from "@apple-cua/core";
import type { Command } from "commander";

export type { MirroringSessionState } from "@apple-cua/core";
type Direction = "up" | "down" | "left" | "right";
type SwipeKind = "flick" | "drag";

type StatusOutput = {
	readonly lines: readonly string[];
	readonly exitCode: 0 | 1;
};

type RegisterIosOptions = {
	readonly isJsonOutput: () => boolean;
};

/** Pure status rendering, kept independent of a live phone for callers and tests. */
export function formatIosStatus(state: MirroringSessionState): StatusOutput {
	return {
		lines: [state, describeMirroringState(state)],
		exitCode: state === "ready" ? 0 : 1,
	};
}

export function registerIosCommands(program: Command, options: RegisterIosOptions): void {
	const ios = program
		.command("ios")
		.description("Control an iPhone through iPhone Mirroring (background delivery by default)");

	ios.command("status")
		.description("Print the iPhone Mirroring session state")
		.action(async () => {
			const state = await createMirroring().state();
			const output = formatIosStatus(state);
			writeOutput(options, { state, message: output.lines[1] }, output.lines.join("\n"));
			if (output.exitCode !== 0) process.exitCode = output.exitCode;
		});

	ios.command("observe")
		.description("Print visible text, tap centres, window bounds, and capture size")
		.action(async () => {
			const observation = await createMirroring().observe();
			const textLines = observation.texts.map((text) => {
				const centreX = text.x + text.width / 2;
				const centreY = text.y + text.height / 2;
				return `${JSON.stringify(text.text)} at ${formatNumber(centreX)},${formatNumber(centreY)} (confidence ${formatNumber(text.confidence)})`;
			});
			const { window } = observation;
			writeOutput(
				options,
				observation,
				[
					...textLines,
					`Window: ${formatNumber(window.x)},${formatNumber(window.y)} ${formatNumber(window.width)}x${formatNumber(window.height)}`,
					`Capture: ${observation.imageWidth}x${observation.imageHeight}`,
				].join("\n"),
			);
		});

	ios.command("screenshot")
		.description("Save the iPhone Mirroring window as a PNG")
		.requiredOption("-o, --output <path>", "output file path")
		.action(async (commandOptions: { output: string }) => {
			const mirroring = createMirroring();
			const state = await mirroring.state();
			if (state !== "ready") {
				throw new Error(describeMirroringState(state));
			}
			const image = await mirroring.screenshot();
			const size = readImagePixelSize(image);
			writeFileSync(commandOptions.output, image);
			writeOutput(
				options,
				{ ok: true, output: commandOptions.output, width: size.width, height: size.height },
				`Screenshot saved to ${commandOptions.output} (${size.width}x${size.height})`,
			);
		});

	ios.command("tap")
		.description("Tap a point in screen coordinates")
		.requiredOption("-x, --x <number>", "x coordinate", parseFiniteNumber)
		.requiredOption("-y, --y <number>", "y coordinate", parseFiniteNumber)
		.action(async (commandOptions: { x: number; y: number }) => {
			await createMirroring().tap(commandOptions.x, commandOptions.y);
			writeActionOutput(options, "tap", commandOptions, `Tapped ${commandOptions.x},${commandOptions.y}`);
		});

	ios.command("tap-text")
		.description("Tap visible text by its OCR label")
		.argument("<query>", "text to find")
		.option("--index <number>", "zero-based match index", parseNonNegativeInteger)
		.option("--exact", "require an exact case-insensitive match")
		.action(async (query: string, commandOptions: { index?: number; exact?: boolean }) => {
			const text = await createMirroring().tapText(query, commandOptions);
			writeOutput(
				options,
				{ ok: true, action: "tap-text", query, match: text },
				`Tapped ${JSON.stringify(text.text)}`,
			);
		});

	ios.command("long-press")
		.description("Press and hold a point in screen coordinates")
		.requiredOption("-x, --x <number>", "x coordinate", parseFiniteNumber)
		.requiredOption("-y, --y <number>", "y coordinate", parseFiniteNumber)
		.option("--duration <ms>", "hold duration in milliseconds", parsePositiveNumber, 800)
		.action(async (commandOptions: { x: number; y: number; duration: number }) => {
			await createMirroring().longPress(commandOptions.x, commandOptions.y, commandOptions.duration);
			writeActionOutput(
				options,
				"long-press",
				commandOptions,
				`Long-pressed ${commandOptions.x},${commandOptions.y} for ${commandOptions.duration}ms`,
			);
		});

	ios.command("swipe")
		.description("Swipe in the direction the finger should move")
		.argument("<direction>", "up, down, left, or right", parseDirection)
		.option("--distance <fraction>", "fraction of the phone window (0..1)", parseFraction, 0.5)
		.option("--kind <kind>", "flick or drag", parseSwipeKind, "flick")
		.action(async (direction: Direction, commandOptions: { distance: number; kind: SwipeKind }) => {
			await createMirroring().swipe(direction, commandOptions);
			writeActionOutput(options, "swipe", { direction, ...commandOptions }, `Swiped ${direction}`);
		});

	ios.command("scroll")
		.description("Scroll toward content to reveal (down reveals content further down)")
		.argument("<direction>", "up, down, left, or right", parseDirection)
		.option("--amount <fraction>", "fraction of the phone window (0..1)", parseFraction, 0.3)
		.option("--at-x <number>", "x coordinate for the scroll", parseFiniteNumber)
		.option("--at-y <number>", "y coordinate for the scroll", parseFiniteNumber)
		.action(async (direction: Direction, commandOptions: { amount: number; atX?: number; atY?: number }) => {
			if ((commandOptions.atX === undefined) !== (commandOptions.atY === undefined)) {
				throw new Error("--at-x and --at-y must be provided together");
			}
			const at =
				commandOptions.atX === undefined || commandOptions.atY === undefined
					? undefined
					: { x: commandOptions.atX, y: commandOptions.atY };
			await createMirroring().scroll(direction, {
				amount: commandOptions.amount,
				...(at === undefined ? {} : { at }),
			});
			writeActionOutput(
				options,
				"scroll",
				{ direction, amount: commandOptions.amount, ...(at === undefined ? {} : { at }) },
				`Scrolled ${direction}`,
			);
		});

	ios.command("type")
		.description("Type text into the focused iPhone field (exact paste by default)")
		.argument("<text>", "text to type")
		.option("--keystrokes", "send keystrokes instead of exact paste")
		.action(async (text: string, commandOptions: { keystrokes?: boolean }) => {
			const mode = commandOptions.keystrokes === true ? "keystrokes" : "paste";
			await createMirroring().typeText(text, { mode });
			writeActionOutput(options, "type", { text, mode }, `Typed ${text.length} characters via ${mode}`);
		});

	ios.command("key")
		.description("Press a key combination (for example cmd+1)")
		.argument("<combo>", "key combination")
		.action(async (combo: string) => {
			await createMirroring().pressKeys(combo);
			writeActionOutput(options, "key", { combo }, `Pressed ${combo}`);
		});

	ios.command("home")
		.description("Go to the iPhone Home Screen")
		.action(async () => {
			await createMirroring().home();
			writeActionOutput(options, "home", {}, "Opened the iPhone Home Screen");
		});

	ios.command("app-switcher")
		.description("Open the iPhone app switcher")
		.action(async () => {
			await createMirroring().appSwitcher();
			writeActionOutput(options, "app-switcher", {}, "Opened the iPhone app switcher");
		});

	ios.command("open-app")
		.description("Open an iPhone app by name")
		.argument("<name>", "app name")
		.action(async (name: string) => {
			await createMirroring().openApp(name);
			writeActionOutput(options, "open-app", { name }, `Opened ${name}`);
		});
}

function createMirroring(): IPhoneMirroring {
	return new IPhoneMirroring({ delivery: "background" });
}

function writeOutput(options: RegisterIosOptions, jsonValue: unknown, humanValue: string): void {
	process.stdout.write(options.isJsonOutput() ? `${JSON.stringify(jsonValue)}\n` : `${humanValue}\n`);
}

function writeActionOutput(
	options: RegisterIosOptions,
	action: string,
	args: Record<string, unknown>,
	humanValue: string,
): void {
	writeOutput(options, { ok: true, action, args }, humanValue);
}

function parseFiniteNumber(value: string): number {
	const number = Number(value);
	if (!Number.isFinite(number)) throw new Error("value must be a finite number");
	return number;
}

function parsePositiveNumber(value: string): number {
	const number = parseFiniteNumber(value);
	if (number <= 0) throw new Error("value must be positive");
	return number;
}

function parseNonNegativeInteger(value: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) throw new Error("value must be a non-negative integer");
	return number;
}

function parseFraction(value: string): number {
	const number = parseFiniteNumber(value);
	if (number < 0 || number > 1) throw new Error("value must be between 0 and 1");
	return number;
}

function parseDirection(value: string): Direction {
	if (value === "up" || value === "down" || value === "left" || value === "right") return value;
	throw new Error("direction must be up, down, left, or right");
}

function parseSwipeKind(value: string): SwipeKind {
	if (value === "flick" || value === "drag") return value;
	throw new Error("kind must be flick or drag");
}

function formatNumber(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

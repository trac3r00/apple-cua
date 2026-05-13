#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MacOSHostComputer } from "@macos-cua/core";
import { Command } from "commander";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const packageJson = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8"));

const program = new Command();

program.name("macos-cua").description("Native macOS computer-use control").version(packageJson.version);

program
	.command("screenshot")
	.description("Capture a screenshot")
	.option("-o, --output <path>", "output file path", "screenshot.png")
	.option("-x, --x <number>", "region x", Number.parseInt)
	.option("-y, --y <number>", "region y", Number.parseInt)
	.option("-w, --width <number>", "region width", Number.parseInt)
	.option("-h, --height <number>", "region height", Number.parseInt)
	.action(async (options) => {
		const computer = new MacOSHostComputer();
		const screenshotOptions =
			options.x !== undefined &&
			options.y !== undefined &&
			options.width !== undefined &&
			options.height !== undefined
				? {
						region: {
							x: options.x,
							y: options.y,
							width: options.width,
							height: options.height,
						},
					}
				: undefined;

		const result = await computer.screenshot(screenshotOptions);
		await writeFileSync(options.output, result.data);
		// biome-ignore lint/suspicious/noConsoleLog: CLI output
		console.log(`Screenshot saved to ${options.output}`);
		await computer.close();
	});

program
	.command("click")
	.description("Click at a position")
	.requiredOption("-x, --x <number>", "x coordinate", Number.parseInt)
	.requiredOption("-y, --y <number>", "y coordinate", Number.parseInt)
	.action(async (options) => {
		const computer = new MacOSHostComputer();
		await computer.click({ x: options.x, y: options.y });
		// biome-ignore lint/suspicious/noConsoleLog: CLI output
		console.log(`Clicked at ${options.x},${options.y}`);
		await computer.close();
	});

program
	.command("type")
	.description("Type text")
	.argument("<text>", "text to type")
	.action(async (text) => {
		const computer = new MacOSHostComputer();
		await computer.type(text);
		// biome-ignore lint/suspicious/noConsoleLog: CLI output
		console.log(`Typed: ${text}`);
		await computer.close();
	});

program
	.command("key")
	.description("Press a key")
	.argument("<key>", "key to press")
	.option("-m, --modifiers <modifiers>", "modifiers (comma-separated: cmd,alt,ctrl,shift)")
	.action(async (key, options) => {
		const computer = new MacOSHostComputer();
		const modifiers = (options.modifiers?.split(",") as Array<"command" | "option" | "control" | "shift">) ?? [];
		await computer.key(key, { modifiers });
		// biome-ignore lint/suspicious/noConsoleLog: CLI output
		console.log(`Pressed: ${modifiers.length > 0 ? `${modifiers.join("+")}+` : ""}${key}`);
		await computer.close();
	});

program
	.command("cursor")
	.description("Get cursor position")
	.action(async () => {
		const computer = new MacOSHostComputer();
		const pos = await computer.getCursorPosition();
		// biome-ignore lint/suspicious/noConsoleLog: CLI output
		console.log(`${pos.x},${pos.y}`);
		await computer.close();
	});

program
	.command("screen")
	.description("Get screen size")
	.action(async () => {
		const computer = new MacOSHostComputer();
		const size = await computer.getScreenSize();
		// biome-ignore lint/suspicious/noConsoleLog: CLI output
		console.log(`${size.width}x${size.height}`);
		await computer.close();
	});

import { writeFileSync } from "node:fs";

program.parse();

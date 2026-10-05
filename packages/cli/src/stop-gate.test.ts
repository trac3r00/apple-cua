import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StopSwitch } from "@apple-cua/core";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commandPathOf, isInputCommand, stopRefusalFor } from "./stop-gate.js";

const INPUT_COMMANDS = [
	"click",
	"right-click",
	"middle-click",
	"double-click",
	"move",
	"drag",
	"scroll",
	"type",
	"key",
	"keypress",
	"apps set-value",
	"apps perform-action",
	"apps select-text",
	"ios tap",
	"ios tap-text",
	"ios long-press",
	"ios swipe",
	"ios scroll",
	"ios type",
	"ios key",
	"ios home",
	"ios app-switcher",
	"ios open-app",
];
const READ_ONLY_COMMANDS = [
	"screenshot",
	"windows list",
	"windows active",
	"apps list",
	"apps state",
	"permissions check",
	"permissions request",
	"stop",
	"resume",
	"stop-status",
	"ios status",
	"ios observe",
	"ios screenshot",
	"cursor",
	"screen",
	"wait",
];

describe("#given the CLI stop gate", () => {
	let stateDir: string;
	let stopSwitch: StopSwitch;

	beforeEach(() => {
		stateDir = mkdtempSync(join(tmpdir(), "apple-cua-cli-stop-"));
		stopSwitch = new StopSwitch(stateDir);
	});

	afterEach(() => {
		rmSync(stateDir, { recursive: true, force: true });
	});

	it.each(INPUT_COMMANDS)("#when stopped #then %s is refused with the stop message", (path) => {
		// given
		stopSwitch.stop("testing", "cli");

		// when
		const refusal = stopRefusalFor(path, stopSwitch);

		// then
		expect(refusal).toContain("stopped computer use");
		expect(refusal).toContain("apple-cua resume");
	});

	it.each(READ_ONLY_COMMANDS)("#when stopped #then read-only %s is not refused", (path) => {
		// given
		stopSwitch.stop("testing", "cli");

		// when
		const refusal = stopRefusalFor(path, stopSwitch);

		// then
		expect(refusal).toBeUndefined();
		expect(isInputCommand(path)).toBe(false);
	});

	it.each(INPUT_COMMANDS)("#when not stopped #then %s is allowed", (path) => {
		// when
		const refusal = stopRefusalFor(path, stopSwitch);

		// then
		expect(refusal).toBeUndefined();
	});

	it("#when the stop file is malformed #then input commands fail closed", () => {
		// given
		stopSwitch.stop("testing", "cli");
		writeMalformed(stopSwitch.path);

		// when
		const refusal = stopRefusalFor("type", stopSwitch);

		// then
		expect(refusal).toContain("stopped computer use");
	});

	it("#given a nested command #when its path is read #then it is the names below the program", () => {
		// given
		const program = new Command("apple-cua");
		const ios = program.command("ios");
		const tap = ios.command("tap");
		const click = program.command("click");

		// when / then
		expect(commandPathOf(tap)).toBe("ios tap");
		expect(commandPathOf(click)).toBe("click");
		expect(commandPathOf(program)).toBe("");
	});
});

function writeMalformed(path: string): void {
	writeFileSync(path, "{not json");
}

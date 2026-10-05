import { type StopStatusSource, describeUserStop } from "@apple-cua/core";
import type { Command } from "commander";

/**
 * Commands that send input or change app state on the person's behalf, as their space-joined path
 * below the program. Everything else (screenshots, listings, permissions, stop/resume/stop-status)
 * only reads or manages the stop itself, so it keeps working while computer use is stopped.
 */
const INPUT_COMMAND_PATHS: ReadonlySet<string> = new Set([
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
]);

export function isInputCommand(commandPath: string): boolean {
	return INPUT_COMMAND_PATHS.has(commandPath);
}

/** The refusal to show when `commandPath` is an input command and the stop switch is on, else undefined. */
export function stopRefusalFor(commandPath: string, stopSwitch: StopStatusSource): string | undefined {
	if (!isInputCommand(commandPath)) {
		return undefined;
	}
	const status = stopSwitch.status();
	return status.stopped ? describeUserStop(status) : undefined;
}

/** "ios tap" for `apple-cua ios tap`: the command names from just below the program down to the command. */
export function commandPathOf(command: Command): string {
	const names: string[] = [];
	for (let current: Command | null = command; current?.parent; current = current.parent) {
		names.unshift(current.name());
	}
	return names.join(" ");
}

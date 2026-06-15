import type { KeyOptions } from "../types/index.js";
import { parseKeyChord } from "./actions.js";
import type { ComputerInterface } from "./interface.js";

export interface KeySequenceEntry {
	readonly key: string;
	readonly holdSeconds?: number;
}

export interface KeySequenceOptions {
	readonly holdSeconds?: number;
	readonly intervalSeconds?: number;
}

export async function pressKeySequence(
	computer: ComputerInterface,
	entries: readonly KeySequenceEntry[],
	options?: KeySequenceOptions,
): Promise<void> {
	if (entries.length === 0) {
		throw new Error("press_keys requires at least one key");
	}
	const defaultHoldMilliseconds = secondsToMilliseconds(options?.holdSeconds, "hold_seconds");
	const intervalMilliseconds = secondsToMilliseconds(options?.intervalSeconds, "interval_seconds") ?? 0;
	for (const [index, entry] of entries.entries()) {
		const chord = parseKeyChord(entry.key);
		const holdMilliseconds =
			secondsToMilliseconds(entry.holdSeconds, `keys[${index}].hold_seconds`) ?? defaultHoldMilliseconds;
		await computer.key(chord.key, keyOptionsFor(chord.modifiers, holdMilliseconds));
		if (intervalMilliseconds > 0 && index < entries.length - 1) {
			await sleep(intervalMilliseconds);
		}
	}
}

function keyOptionsFor(
	modifiers: readonly KeyModifier[],
	holdMilliseconds: number | undefined,
): KeyOptions | undefined {
	if (modifiers.length === 0 && holdMilliseconds === undefined) {
		return undefined;
	}
	if (holdMilliseconds === undefined) {
		return { modifiers: [...modifiers] };
	}
	if (modifiers.length === 0) {
		return { holdMilliseconds };
	}
	return { modifiers: [...modifiers], holdMilliseconds };
}

function secondsToMilliseconds(seconds: number | undefined, label: string): number | undefined {
	if (seconds === undefined) {
		return undefined;
	}
	if (!Number.isFinite(seconds) || seconds < 0) {
		throw new Error(`${label} must be a finite non-negative number`);
	}
	return Math.round(seconds * 1000);
}

function sleep(milliseconds: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});
}

type KeyModifier = NonNullable<KeyOptions["modifiers"]>[number];

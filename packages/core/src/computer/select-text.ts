import type { SelectTextOptions } from "../types/index.js";

export type SelectionMode = SelectTextOptions["selection"];

export interface SelectionRangeInput extends SelectTextOptions {
	readonly value: string;
}

export interface SelectionRange {
	readonly location: number;
	readonly length: number;
}

export function resolveSelectionRange(input: SelectionRangeInput): SelectionRange {
	const match = resolveMatch(input);
	switch (input.selection) {
		case "text":
			return { location: match.start, length: match.length };
		case "before":
			return { location: match.start, length: 0 };
		case "after":
			return { location: match.start + match.length, length: 0 };
	}
}

function resolveMatch(input: SelectionRangeInput): { start: number; length: number } {
	if (input.text === undefined || input.text.length === 0) {
		return { start: 0, length: input.value.length };
	}
	const prefix = input.prefix ?? "";
	const suffix = input.suffix ?? "";
	const needle = `${prefix}${input.text}${suffix}`;
	const needleIndex = input.value.indexOf(needle);
	if (needleIndex < 0) {
		throw new Error(`Could not find the requested text to select: ${input.text}`);
	}
	return { start: needleIndex + prefix.length, length: input.text.length };
}

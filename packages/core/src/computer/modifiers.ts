import type { KeyModifierName } from "../types/index.js";

export type KeyModifier = "command" | "option" | "control" | "shift";

export const MODIFIER_ALIASES = new Map<string, KeyModifier>([
	["cmd", "command"],
	["command", "command"],
	["meta", "command"],
	["super", "command"],
	["alt", "option"],
	["opt", "option"],
	["option", "option"],
	["ctrl", "control"],
	["control", "control"],
	["shift", "shift"],
]);

/**
 * Canonical modifier names for a list a caller gave with aliases (cmd, alt, opt, ctrl): lower-cased,
 * deduplicated, in the order first given. An unknown name is refused rather than dropped, because a
 * click that silently loses its Command would act on a different selection than the caller meant.
 */
export function normalizeModifiers(modifiers: ReadonlyArray<KeyModifierName | string> | undefined): KeyModifier[] {
	const normalized: KeyModifier[] = [];
	for (const name of modifiers ?? []) {
		const modifier = MODIFIER_ALIASES.get(name.trim().toLowerCase());
		if (modifier === undefined) {
			throw new Error(`unsupported modifier: ${name}`);
		}
		if (!normalized.includes(modifier)) {
			normalized.push(modifier);
		}
	}
	return normalized;
}

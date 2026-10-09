import { findTexts } from "@apple-cua/core";
import type { MirroringObservation, MirroringText } from "@apple-cua/core";
import { z } from "zod/v4";
import type { PhoneContextFailure } from "./phone-context.js";

export const iosFindTextSchema = z.object({
	observation_token: z.string().min(1),
	query: z.string().trim().min(1),
	exact: z.boolean().default(false),
	direction: z.enum(["up", "down", "left", "right"]).default("down"),
	max_scrolls: z.number().int().min(0).max(30).default(8),
	timeout_ms: z.number().int().positive().max(30_000).default(10_000),
	amount: z.number().positive().max(1).optional(),
	borrow_pointer: z.boolean().optional(),
	at: z.object({ x: z.number().finite(), y: z.number().finite() }).optional(),
});

export type PhoneSearchInput = z.infer<typeof iosFindTextSchema>;

export interface PhoneSearchOutcome {
	readonly observation: MirroringObservation;
	readonly search: {
		readonly found: boolean;
		readonly reason: "matched" | "max_scrolls" | "no_progress" | "timeout" | "interrupted";
		readonly scrolls: number;
		readonly matches: readonly MirroringText[];
	};
	readonly failure?: PhoneContextFailure;
}

/** Compare OCR geometry with a small tolerance, rather than treating OCR jitter as scrolling. */
function sameView(before: MirroringObservation, after: MirroringObservation): boolean {
	return (
		before.texts.length === after.texts.length &&
		before.texts.every((text, index) => {
			const next = after.texts[index];
			return (
				next !== undefined &&
				text.text === next.text &&
				Math.abs(text.x - next.x) <= 2 &&
				Math.abs(text.y - next.y) <= 2 &&
				Math.abs(text.width - next.width) <= 2 &&
				Math.abs(text.height - next.height) <= 2
			);
		})
	);
}

/** The driver owns all input, stop checks and context checks; this loop only decides whether to keep looking. */
export async function findPhoneText(
	initial: MirroringObservation,
	input: PhoneSearchInput,
	driver: {
		readonly now: () => number;
		readonly advance: (
			previous: MirroringObservation,
			deadline: number,
		) => Promise<{ readonly observation: MirroringObservation; readonly scrolled: boolean } | PhoneContextFailure>;
	},
): Promise<PhoneSearchOutcome> {
	let observation = initial;
	let scrolls = 0;
	let unchanged = 0;
	const deadline = driver.now() + input.timeout_ms;
	const finish = (
		reason: PhoneSearchOutcome["search"]["reason"],
		matches: readonly MirroringText[] = [],
	): PhoneSearchOutcome => ({
		observation,
		search: { found: matches.length > 0, reason, scrolls, matches },
	});

	for (;;) {
		const matches = findTexts(observation.texts, input.query, input.exact);
		if (matches.length > 0) return finish("matched", matches);
		if (scrolls >= input.max_scrolls) return finish("max_scrolls");
		if (unchanged >= 2) return finish("no_progress");
		if (driver.now() >= deadline) return finish("timeout");
		const next = await driver.advance(observation, deadline);
		if ("reason" in next) {
			if (next.actionDispatched === true) scrolls += 1;
			return { ...finish("interrupted"), failure: next };
		}
		if (next.scrolled) {
			scrolls += 1;
			unchanged = sameView(observation, next.observation) ? unchanged + 1 : 0;
		}
		observation = next.observation;
	}
}

import type { UTMObservation } from "@apple-cua/core";
import { z } from "zod/v4";
import type { UtmToolSource } from "./utm-tools.js";

const point = { x: z.number().int().nonnegative(), y: z.number().int().nonnegative() };
export const stepSchema = z.discriminatedUnion("action", [
	z.object({ action: z.literal("observe") }).strict(),
	z.object({ action: z.literal("move"), ...point, coordinate_space: z.literal("guest-display-pixels") }).strict(),
	z.object({ action: z.literal("click-image"), ...point }).strict(),
	z
		.object({
			action: z.literal("click-text"),
			text: z.string().min(1).optional(),
			element_id: z.string().optional(),
		})
		.strict()
		.refine((step) => (step.text === undefined) !== (step.element_id === undefined), "Use text or element_id"),
	z.object({ action: z.literal("type"), text: z.string().max(100_000) }).strict(),
	z.object({ action: z.literal("key"), combo: z.string().min(1).max(256) }).strict(),
	z
		.object({
			action: z.literal("click"),
			...point,
			coordinate_space: z.literal("guest-display-pixels"),
			button: z.enum(["left", "right", "middle"]).optional(),
			monitor: z.number().int().positive().optional(),
		})
		.strict(),
]);

export class UtmRefusal extends Error {
	constructor(
		readonly reason: string,
		message: string,
	) {
		super(message);
	}
}

export function textTargets(observation: UTMObservation, token: string) {
	return observation.texts.map((entry, index) => ({ ...entry, element_id: `${token}:${index}` }));
}

export async function visualAction(
	source: UtmToolSource,
	vm: string,
	step: Extract<z.infer<typeof stepSchema>, { action: "click-image" | "click-text" }>,
	observation: UTMObservation,
	token: string,
	checkContext: () => Promise<void>,
): Promise<void> {
	const fresh = await source.observe(vm);
	await checkContext();
	const a = observation.displayRect;
	const b = fresh.displayRect;
	if (
		fresh.windowId !== observation.windowId ||
		a.x !== b.x ||
		a.y !== b.y ||
		a.width !== b.width ||
		a.height !== b.height ||
		fresh.guestSize.width !== observation.guestSize.width ||
		fresh.guestSize.height !== observation.guestSize.height
	) {
		throw new UtmRefusal("utm-geometry-changed", "Window or display geometry changed; observe again.");
	}
	if (step.action === "click-image") {
		await source.clickObserved(vm, { x: step.x, y: step.y }, observation);
		return;
	}
	const targets = textTargets(observation, token);
	const query = step.text?.toLowerCase();
	const exact = targets.filter((entry) => entry.text.toLowerCase() === query);
	const matches =
		step.element_id !== undefined
			? targets.filter((entry) => entry.element_id === step.element_id)
			: exact.length > 0
				? exact
				: targets.filter((entry) => entry.text.toLowerCase().includes(query ?? ""));
	const target = matches[0];
	if (matches.length !== 1 || target === undefined) {
		throw new UtmRefusal("utm-text-target-not-unique", "Select exactly one observed OCR target.");
	}
	const currentTargets = fresh.texts.filter(
		(entry) =>
			entry.text === target.text &&
			Math.abs(entry.box.x - target.box.x) <= 2 &&
			Math.abs(entry.box.y - target.box.y) <= 2 &&
			Math.abs(entry.box.width - target.box.width) <= 2 &&
			Math.abs(entry.box.height - target.box.height) <= 2,
	);
	if (currentTargets.length !== 1) {
		throw new UtmRefusal("utm-text-target-changed", "The observed text moved or disappeared; observe again.");
	}
	await source.click(vm, {
		x: Math.floor(target.box.x + target.box.width / 2),
		y: Math.floor(target.box.y + target.box.height / 2),
	});
}

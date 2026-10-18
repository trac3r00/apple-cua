import { z } from "zod";

export const httpUrl = z
	.string()
	.max(8192)
	.url()
	.refine((url) => /^https?:\/\//.test(url), "Only HTTP(S) URLs are supported");
export const limitsSchema = z.object({
	maxChars: z.number().int().min(256).max(20000).default(6000),
	maxElements: z.number().int().min(1).max(200).default(80),
	fullPage: z.boolean().default(false),
});
export const stepSchema = z.discriminatedUnion("action", [
	z.object({ action: z.literal("click"), ref: z.number().int().positive() }),
	z.object({ action: z.literal("fill"), ref: z.number().int().positive(), text: z.string().max(10000) }),
	z.object({
		action: z.literal("press"),
		ref: z.number().int().positive(),
		key: z.enum(["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp"]),
	}),
	z.object({ action: z.literal("scroll"), deltaY: z.number().min(-5000).max(5000) }),
]);
export const expectSchema = z.object({
	text: z.string().min(1).max(500),
	timeoutMs: z.number().int().min(1).max(10000).default(3000),
});
export const observationSchema = z.object({
	url: z.string(),
	title: z.string().max(500),
	revision: z.string(),
	rows: z
		.array(
			z.object({
				ref: z.number().int().positive(),
				role: z.string().max(60),
				name: z.string().max(500),
			}),
		)
		.max(200),
	truncated: z.boolean(),
});
export type BrowserObservation = z.infer<typeof observationSchema>;
export type BrowserStep = z.infer<typeof stepSchema>;
export type ObservationLimits = z.infer<typeof limitsSchema>;
export type BrowserExpectation = z.infer<typeof expectSchema>;

export interface RunCommand {
	readonly method: "run";
	readonly tabId: number;
	readonly revision: string;
	readonly steps: readonly BrowserStep[];
	readonly expect: BrowserExpectation | undefined;
	readonly limits: ObservationLimits;
}

export type BrowserCommand =
	| { readonly method: "open"; readonly url: string }
	| { readonly method: "observe"; readonly tabId: number; readonly limits: ObservationLimits }
	| RunCommand
	| { readonly method: "close"; readonly tabId: number }
	| { readonly method: "stop" };

export const replySchema = z.discriminatedUnion("ok", [
	z.object({ id: z.string(), ok: z.literal(true), value: z.unknown() }),
	z.object({ id: z.string(), ok: z.literal(false), error: z.string().max(2000) }),
]);

export class BrowserError extends Error {
	constructor(
		readonly code: "disconnected" | "timeout" | "stopped" | "stale" | "extension" | "busy",
		message: string,
	) {
		super(message);
		this.name = "BrowserError";
	}
}

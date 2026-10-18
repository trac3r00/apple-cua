import { z } from "zod";
import type { BrowserBridge } from "./bridge.js";
import { BrowserError, expectSchema, httpUrl, limitsSchema, stepSchema } from "./protocol.js";
import { BrowserSession } from "./session.js";

const spaceSchema = z
	.string()
	.regex(/^[a-zA-Z0-9_.-]{1,64}$/)
	.default("default");
const pageSchema = z.string().regex(/^p[1-9][0-9]*$/);
export const controllerRequestSchema = z.discriminatedUnion("action", [
	z.object({ action: z.literal("status") }),
	z.object({ action: z.literal("create"), space: spaceSchema }),
	z.object({ action: z.literal("open"), space: spaceSchema, url: httpUrl }),
	z.object({
		action: z.literal("observe"),
		space: spaceSchema,
		page: pageSchema,
		limits: limitsSchema.optional(),
		full: z.boolean().default(false),
	}),
	z.object({
		action: z.literal("run"),
		space: spaceSchema,
		page: pageSchema,
		observation_token: z.string().uuid(),
		steps: z.array(stepSchema).min(1).max(12),
		expect: expectSchema.optional(),
		limits: limitsSchema.optional(),
	}),
	z.object({ action: z.literal("close"), space: spaceSchema, page: pageSchema }),
	z.object({ action: z.literal("finish"), space: spaceSchema }),
]);

/** Named spaces and permanent page labels live in the daemon, not a CLI process. */
export class BrowserController {
	private readonly spaces = new Map<
		string,
		{
			readonly session: BrowserSession;
			readonly pages: Map<string, { readonly tabId: number; readonly generation: number }>;
			nextPage: number;
			finishing: boolean;
			opening: number;
		}
	>();

	private readonly bridge: BrowserBridge;

	constructor(bridge: BrowserBridge) {
		this.bridge = bridge;
	}

	async dispatch(value: unknown, signal?: AbortSignal): Promise<unknown> {
		const input = controllerRequestSchema.parse(value);
		if (signal !== undefined && input.action !== "open")
			return this.bridge.withCancellation(signal, () => this.dispatch(value));
		switch (input.action) {
			case "status":
				return {
					connected: this.bridge.connected,
					stopped: this.bridge.paused,
					spaces: [...this.spaces].map(([space, state]) => ({ space, pages: [...state.pages.keys()] })),
				};
			case "create": {
				const state = this.create(input.space);
				return { space: input.space, pages: [...state.pages.keys()] };
			}
			case "open": {
				const state = this.create(input.space);
				state.opening++;
				try {
					const opened = await state.session.open(input.url, signal);
					const page = `p${state.nextPage++}`;
					state.pages.set(page, { tabId: opened.tabId, generation: this.bridge.generation });
					return { space: input.space, page };
				} finally {
					state.opening--;
				}
			}
			case "observe": {
				const { state, tabId } = this.target(input.space, input.page);
				return {
					space: input.space,
					page: input.page,
					...(await state.session.observe(tabId, input.limits, input.full)),
				};
			}
			case "run": {
				const { state, tabId } = this.target(input.space, input.page);
				return {
					space: input.space,
					page: input.page,
					...(await state.session.run(tabId, input.observation_token, input.steps, input.expect, input.limits)),
				};
			}
			case "close": {
				const { state, tabId } = this.target(input.space, input.page);
				await state.session.close(tabId);
				state.pages.delete(input.page);
				return { space: input.space, closed: input.page };
			}
			case "finish": {
				const state = this.spaces.get(input.space);
				if (state === undefined) throw new BrowserError("stale", "Unknown task space");
				if (state.finishing || state.opening > 0)
					throw new BrowserError("busy", "Task space is opening or finishing");
				state.finishing = true;
				const abandoned: string[] = [];
				try {
					for (const [page, owned] of state.pages) {
						if (owned.generation !== this.bridge.generation) abandoned.push(page);
						else await state.session.close(owned.tabId);
						state.pages.delete(page);
					}
					this.spaces.delete(input.space);
				} finally {
					state.finishing = false;
				}
				return abandoned.length === 0 ? { finished: input.space } : { finished: input.space, abandoned };
			}
		}
	}

	private create(space: string) {
		const existing = this.spaces.get(space);
		if (existing !== undefined) {
			if (existing.finishing) throw new BrowserError("busy", "Task space is finishing");
			return existing;
		}
		const state = {
			session: new BrowserSession(this.bridge),
			pages: new Map<string, { readonly tabId: number; readonly generation: number }>(),
			nextPage: 1,
			finishing: false,
			opening: 0,
		};
		this.spaces.set(space, state);
		return state;
	}

	private target(space: string, page: string) {
		const state = this.spaces.get(space);
		const owned = state?.pages.get(page);
		if (state === undefined || owned === undefined) throw new BrowserError("stale", "Unknown task space or page");
		if (state.finishing) throw new BrowserError("busy", "Task space is finishing");
		return { state, tabId: owned.tabId };
	}
}

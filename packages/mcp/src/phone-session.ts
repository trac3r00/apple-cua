import type { IPhoneMirroring, MirroringObservation } from "@apple-cua/core";
import type { StopStatusSource } from "@apple-cua/core";
import {
	InputInterrupted,
	describeMirroringState,
	describeUserStop,
	findTexts,
	runInInputScope,
} from "@apple-cua/core";
import { type PhoneContextFailure, phoneContextFailure } from "./phone-context.js";
import { phoneFailureResult, projectPhoneObservation, projectPhoneSearch } from "./phone-result.js";
import { findPhoneText } from "./phone-search.js";
import type { PhoneSearchInput } from "./phone-search.js";
import { type ToolResult, refusalResult, textResult } from "./tool-result.js";

export type PhoneToolSource = Pick<
	IPhoneMirroring,
	| "observe"
	| "screenshot"
	| "tap"
	| "longPress"
	| "swipe"
	| "scroll"
	| "typeText"
	| "pressKeys"
	| "home"
	| "appSwitcher"
	| "openApp"
>;

export type PhoneValidation = { readonly x?: number; readonly y?: number };

export class PhoneGuardSession {
	private readonly tokens = new Map<
		string,
		{ observation: MirroringObservation; issuedAt: number; consumed: boolean }
	>();
	private readonly ttlMs: number;
	private readonly now: () => number;
	private readonly stopSwitch: StopStatusSource | undefined;
	private tail: Promise<void> = Promise.resolve();

	constructor(
		private readonly source: PhoneToolSource,
		options: { readonly ttlMs?: number; readonly now?: () => number; readonly stopSwitch?: StopStatusSource } = {},
	) {
		this.ttlMs = options.ttlMs ?? 120_000;
		this.now = options.now ?? Date.now;
		this.stopSwitch = options.stopSwitch;
	}

	async observe(): Promise<ToolResult> {
		return this.serial(async () => this.observeCurrent());
	}

	private async observeCurrent(): Promise<ToolResult> {
		this.tokens.clear();
		try {
			const observation = await this.source.observe();
			if (observation.state !== "ready")
				return refusalResult("phone-not-ready", describeMirroringState(observation.state));
			const token = this.issue(observation);
			return textResult(
				JSON.stringify({ ...projectPhoneObservation(observation), observation_token: token }, null, 2),
			);
		} catch (error) {
			return refusalResult("phone-observe-failed", error instanceof Error ? error.message : String(error));
		}
	}

	async screenshot(path?: string): Promise<ToolResult> {
		return this.serial(async () => this.captureCurrent(path));
	}

	private async captureCurrent(path?: string): Promise<ToolResult> {
		try {
			const observation = await this.source.observe();
			if (observation.state !== "ready")
				return refusalResult("phone-not-ready", describeMirroringState(observation.state));
			const image = await this.source.screenshot();
			if (path !== undefined) {
				const { writeFile } = await import("node:fs/promises");
				await writeFile(path, image);
			}
			return textResult(
				JSON.stringify(
					{
						base64_png: image.toString("base64"),
						width: observation.imageWidth,
						height: observation.imageHeight,
						...(path === undefined ? {} : { path }),
					},
					null,
					2,
				),
			);
		} catch (error) {
			return refusalResult("phone-screenshot-failed", error instanceof Error ? error.message : String(error));
		}
	}

	async consume<T>(
		token: string | undefined,
		validation: PhoneValidation,
		mutation: (observation: MirroringObservation) => Promise<T>,
	): Promise<ToolResult> {
		return this.serial(async () => this.consumeCurrent(token, validation, mutation));
	}

	private async consumeCurrent<T>(
		token: string | undefined,
		validation: PhoneValidation,
		mutation: (observation: MirroringObservation) => Promise<T>,
	): Promise<ToolResult> {
		const current = await this.preflight(token, validation);
		if ("reason" in current) return refusalResult(current.reason, current.message);
		let dispatched = false;
		try {
			await mutation(current);
			dispatched = true;
			const fresh = await this.source.observe();
			const failure = phoneContextFailure(current, fresh, this.stopSwitch?.status());
			if (failure !== undefined) return phoneFailureResult({ ...failure, actionDispatched: true });
			return textResult(
				JSON.stringify(
					{ actionDispatched: true, ...projectPhoneObservation(fresh), observation_token: this.issue(fresh) },
					null,
					2,
				),
			);
		} catch (error) {
			return phoneFailureResult({
				reason: this.interruptedReason(error) ?? "phone-action-failed",
				message: error instanceof Error ? error.message : String(error),
				inputAttempted: true,
				...(dispatched ? { actionDispatched: true } : {}),
			});
		}
	}

	async findText(input: PhoneSearchInput): Promise<ToolResult> {
		return this.serial(async () => {
			const initial = await this.preflight(input.observation_token, input.at ?? {});
			if ("reason" in initial) return refusalResult(initial.reason, initial.message);
			const outcome = await findPhoneText(initial, input, {
				now: this.now,
				advance: async (previous, deadline) => {
					const current = await this.refresh(previous, input.at ?? {});
					if ("reason" in current) return current;
					if (findTexts(current.texts, input.query, input.exact).length > 0 || this.now() >= deadline)
						return { observation: current, scrolled: false };
					let dispatched = false;
					try {
						await this.source.scroll(input.direction, {
							...(input.amount === undefined ? {} : { amount: input.amount }),
							...(input.at === undefined ? {} : { at: input.at }),
							...(input.borrow_pointer === undefined ? {} : { borrowPointer: input.borrow_pointer }),
						});
						dispatched = true;
						const fresh = await this.source.observe();
						const failure = phoneContextFailure(current, fresh, this.stopSwitch?.status());
						return failure === undefined
							? { observation: fresh, scrolled: true }
							: { ...failure, actionDispatched: true };
					} catch (error) {
						return {
							reason: this.interruptedReason(error) ?? "phone-search-failed",
							message: error instanceof Error ? error.message : String(error),
							inputAttempted: true,
							...(dispatched ? { actionDispatched: true } : {}),
						};
					}
				},
			});
			return {
				...textResult(
					JSON.stringify({
						...projectPhoneSearch(outcome, input.query),
						...(outcome.failure === undefined ? { observation_token: this.issue(outcome.observation) } : {}),
					}),
				),
				...(outcome.failure === undefined ? {} : { isError: true }),
			};
		});
	}

	private async preflight(
		token: string | undefined,
		validation: PhoneValidation,
	): Promise<MirroringObservation | PhoneContextFailure> {
		const stop = this.stopSwitch?.status();
		if (stop?.stopped === true) return { reason: "user-stopped", message: describeUserStop(stop) };
		const entry = token === undefined ? undefined : this.tokens.get(token);
		if (entry === undefined)
			return {
				reason: "phone-token-missing",
				message: "an observation_token is required for iPhone Mirroring input.",
			};
		if (entry.consumed)
			return { reason: "phone-token-consumed", message: "the observation_token has already been used" };
		if (this.now() - entry.issuedAt >= this.ttlMs)
			return { reason: "phone-token-expired", message: "the observation_token has expired" };
		if (entry.observation.state !== "ready")
			return { reason: "phone-not-ready", message: describeMirroringState(entry.observation.state) };
		entry.consumed = true;
		return this.refresh(entry.observation, validation);
	}

	private async refresh(
		previous: MirroringObservation,
		validation: PhoneValidation,
	): Promise<MirroringObservation | PhoneContextFailure> {
		let current: MirroringObservation;
		try {
			current = await this.source.observe();
		} catch (error) {
			return { reason: "phone-not-ready", message: error instanceof Error ? error.message : String(error) };
		}
		const failure = phoneContextFailure(previous, current, this.stopSwitch?.status());
		if (failure !== undefined) return failure;
		const { x, y } = validation;
		if ((x !== undefined || y !== undefined) && (x === undefined || y === undefined || !inside(current, x, y))) {
			return {
				reason: "phone-coordinate-outside-window",
				message: "coordinates must lie inside the observed iPhone Mirroring window",
			};
		}
		return current;
	}

	private issue(observation: MirroringObservation): string {
		for (const [token, entry] of this.tokens) {
			if (!entry.consumed || this.now() - entry.issuedAt >= this.ttlMs) this.tokens.delete(token);
		}
		// Retain only the last consumed token, so immediate reuse still has an explicit reason.
		while (this.tokens.size > 1) {
			const oldest = this.tokens.keys().next().value;
			if (oldest !== undefined) this.tokens.delete(oldest);
		}
		const token = `${this.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
		this.tokens.set(token, { observation, issuedAt: this.now(), consumed: false });
		return token;
	}

	private serial<T>(run: () => Promise<T>): Promise<T> {
		const result = this.tail.then(() =>
			runInInputScope(
				{
					interruption: () => {
						const stop = this.stopSwitch?.status();
						return stop?.stopped === true ? describeUserStop(stop) : undefined;
					},
				},
				run,
			),
		);
		this.tail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	private interruptedReason(error: unknown): string | undefined {
		if (!(error instanceof InputInterrupted)) return undefined;
		return this.stopSwitch?.status().stopped === true ? "user-stopped" : "interrupted";
	}
}

function inside(observation: MirroringObservation, x: number, y: number): boolean {
	const w = observation.window;
	return x >= w.x && y >= w.y && x < w.x + w.width && y < w.y + w.height;
}

import type { IPhoneMirroring, MirroringObservation, MirroringText } from "@apple-cua/core";
import type { StopStatusSource } from "@apple-cua/core";
import { describeMirroringState, describeUserStop } from "@apple-cua/core";
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

	constructor(
		private readonly source: PhoneToolSource,
		options: { readonly ttlMs?: number; readonly now?: () => number; readonly stopSwitch?: StopStatusSource } = {},
	) {
		this.ttlMs = options.ttlMs ?? 120_000;
		this.now = options.now ?? Date.now;
		this.stopSwitch = options.stopSwitch;
	}

	async observe(): Promise<ToolResult> {
		try {
			const observation = await this.source.observe();
			if (observation.state !== "ready")
				return refusalResult("phone-not-ready", describeMirroringState(observation.state));
			const token = this.issue(observation);
			return textResult(JSON.stringify({ ...projectObservation(observation), observation_token: token }, null, 2));
		} catch (error) {
			return refusalResult("phone-observe-failed", error instanceof Error ? error.message : String(error));
		}
	}

	async screenshot(path?: string): Promise<ToolResult> {
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
		const stop = this.stopSwitch?.status();
		if (stop?.stopped === true) return refusalResult("user-stopped", describeUserStop(stop));
		const entry = token === undefined ? undefined : this.tokens.get(token);
		if (entry === undefined)
			return refusalResult("phone-token-missing", "an observation_token is required for iPhone Mirroring input.");
		if (entry.consumed) return refusalResult("phone-token-consumed", "the observation_token has already been used");
		if (this.now() - entry.issuedAt >= this.ttlMs)
			return refusalResult("phone-token-expired", "the observation_token has expired");
		if (entry.observation.state !== "ready")
			return refusalResult("phone-not-ready", describeMirroringState(entry.observation.state));
		const current = await this.source.observe().catch(() => undefined);
		if (current === undefined || current.state !== "ready") {
			return refusalResult("phone-not-ready", describeMirroringState(current?.state ?? "not-running"));
		}
		if (current.window.id !== entry.observation.window.id)
			return refusalResult("phone-window-changed", "the observed iPhone Mirroring window changed");
		const { x, y } = validation;
		if (
			(x !== undefined || y !== undefined) &&
			(x === undefined || y === undefined || !inside(entry.observation, x, y))
		) {
			return refusalResult(
				"phone-coordinate-outside-window",
				"coordinates must lie inside the observed iPhone Mirroring window",
			);
		}
		entry.consumed = true;
		try {
			await mutation(entry.observation);
			const fresh = await this.source.observe();
			if (fresh.state !== "ready") return refusalResult("phone-not-ready", describeMirroringState(fresh.state));
			return textResult(
				JSON.stringify(
					{ actionDispatched: true, ...projectObservation(fresh), observation_token: this.issue(fresh) },
					null,
					2,
				),
			);
		} catch (error) {
			return refusalResult("phone-action-failed", error instanceof Error ? error.message : String(error));
		}
	}

	private issue(observation: MirroringObservation): string {
		const token = `${this.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
		this.tokens.set(token, { observation, issuedAt: this.now(), consumed: false });
		return token;
	}
}

function projectObservation(observation: MirroringObservation): Record<string, unknown> {
	return {
		state: observation.state,
		window: observation.window,
		image_size: { width: observation.imageWidth, height: observation.imageHeight },
		texts: observation.texts.map((text: MirroringText) => ({
			text: text.text,
			confidence: text.confidence,
			x: text.x,
			y: text.y,
			width: text.width,
			height: text.height,
			center: { x: text.x + text.width / 2, y: text.y + text.height / 2 },
		})),
	};
}

function inside(observation: MirroringObservation, x: number, y: number): boolean {
	const w = observation.window;
	return x >= w.x && y >= w.y && x <= w.x + w.width && y <= w.y + w.height;
}

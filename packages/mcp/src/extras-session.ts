import { randomUUID } from "node:crypto";
import type { HostCapabilities, MenuExtraSnapshot, StopStatusSource } from "@apple-cua/core";
import { createNativeMenuExtrasSource, describeUserStop } from "@apple-cua/core";
import type { ToolResult } from "./tool-result.js";
import { refusalResult, textResult } from "./tool-result.js";

const CONTROL_CENTER_BUNDLE_ID = "com.apple.controlcenter";
const MENU_EXTRA_ROLES = new Set(["AXMenuBarItem", "AXStatusBarItem"]);
const MENU_EXTRA_TTL_MS = 120_000;

interface MenuExtrasSource {
	read(): Promise<MenuExtraSnapshot>;
	act(snapshot: MenuExtraSnapshot, elementId: number): Promise<void>;
}

interface Observation {
	readonly snapshot: MenuExtraSnapshot;
	readonly issuedAt: number;
}

export interface ExtrasGuardOptions {
	readonly allowedBundleIds: readonly string[] | undefined;
	readonly delivery: "background" | "attended";
	readonly probeHost: () => HostCapabilities;
	readonly stopSwitch?: StopStatusSource;
	readonly now?: () => number;
	readonly ttlMs?: number;
	readonly source?: ExtrasSource;
}

export type ExtrasSource = MenuExtrasSource;

export class ExtrasGuardSession {
	private readonly source: MenuExtrasSource;
	private readonly now: () => number;
	private readonly ttlMs: number;
	private readonly tokens = new Map<string, Observation>();
	private stopped = false;
	private tail: Promise<void> = Promise.resolve();

	constructor(
		source: MenuExtrasSource | undefined,
		private readonly options: ExtrasGuardOptions,
	) {
		this.source = source ?? options.source ?? createNativeMenuExtrasSource();
		this.now = options.now ?? Date.now;
		this.ttlMs = options.ttlMs ?? MENU_EXTRA_TTL_MS;
	}

	observe(): Promise<ToolResult> {
		return this.serial(async () => {
			this.tokens.clear();
			const refusal = this.policyRefusal(false);
			if (refusal !== undefined) return refusal;
			try {
				const snapshot = await this.source.read();
				const afterRead = this.policyRefusal(false);
				if (afterRead !== undefined) return afterRead;
				const token = randomUUID();
				this.tokens.set(token, { snapshot, issuedAt: this.now() });
				return textResult(
					JSON.stringify({
						surface: "menubar",
						pid: snapshot.pid,
						items: snapshot.items,
						truncated: snapshot.truncated,
						observation_token: token,
						delivery: { mode: this.options.delivery, modes: ["background", "attended"] },
					}),
				);
			} catch (error) {
				return refusalResult("menubar-observe-failed", error instanceof Error ? error.message : String(error));
			}
		});
	}

	act(token: string, elementId: number): Promise<ToolResult> {
		return this.serial(async () => {
			const observation = this.tokens.get(token);
			this.tokens.delete(token);
			if (observation === undefined) return refusalResult("menubar-token-invalid");
			if (this.now() - observation.issuedAt >= this.ttlMs) return refusalResult("menubar-token-expired");
			const matches = observation.snapshot.items.filter((item) => item.id === elementId);
			const item = matches[0];
			if (matches.length !== 1 || item === undefined || !MENU_EXTRA_ROLES.has(item.role))
				return refusalResult("menubar-element-not-observed");
			if (!item.actions.includes("AXPress")) return refusalResult("menubar-action-not-advertised");
			const refusal = this.policyRefusal(true);
			if (refusal !== undefined) return refusal;
			try {
				await this.source.act(observation.snapshot, elementId);
				return textResult(JSON.stringify({ actionDispatched: true, surface: "menubar", elementId }));
			} catch (error) {
				return refusalResult("menubar-action-failed", error instanceof Error ? error.message : String(error));
			}
		});
	}

	close(): void {
		this.stopped = true;
		this.tokens.clear();
	}

	private policyRefusal(mutation: boolean): ToolResult | undefined {
		if (this.stopped) return refusalResult("menubar-session-closed");
		const stop = this.options.stopSwitch?.status();
		if (stop?.stopped === true) return refusalResult("user-stopped", describeUserStop(stop));
		if (
			this.options.allowedBundleIds !== undefined &&
			!this.options.allowedBundleIds.some((id) => id.toLowerCase() === CONTROL_CENTER_BUNDLE_ID)
		)
			return refusalResult("menubar-not-approved", "Allow com.apple.controlcenter to use menu extras.");
		const host = this.options.probeHost();
		if (!host.permissions.accessibility) return refusalResult("accessibility-permission-required");
		if (host.session.screenLocked) return refusalResult("screen-locked");
		if (mutation && (this.options.delivery !== "attended" || host.session.onConsole !== true))
			return refusalResult("menubar-mutation-unavailable");
		return undefined;
	}

	private serial<T>(run: () => Promise<T>): Promise<T> {
		const result = this.tail.then(run);
		this.tail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}
}

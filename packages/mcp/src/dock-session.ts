import { randomUUID } from "node:crypto";
import type { DockAction, DockSnapshot, DockSource, HostCapabilities, StopStatusSource } from "@apple-cua/core";
import { createNativeDockSource, describeUserStop } from "@apple-cua/core";
import type { ToolResult } from "./tool-result.js";
import { refusalResult, textResult } from "./tool-result.js";

const DOCK_BUNDLE_ID = "com.apple.dock";
const DOCK_ROLES = new Set(["AXDockItem", "AXMenuItem"]);
const DOCK_ACTIONS = new Set<DockAction>(["AXPress", "AXShowMenu", "AXCancel"]);

interface DockToken {
	readonly snapshot: DockSnapshot;
	readonly issuedAt: number;
}

export interface DockGuardOptions {
	readonly allowedBundleIds: readonly string[];
	readonly delivery: "background" | "attended";
	readonly probeHost: () => HostCapabilities;
	readonly stopSwitch?: StopStatusSource;
	readonly now?: () => number;
	readonly ttlMs?: number;
}

export class DockGuardSession {
	private readonly source: DockSource;
	private readonly tokens = new Map<string, DockToken>();
	private readonly now: () => number;
	private readonly ttlMs: number;
	private tail: Promise<void> = Promise.resolve();
	private stopped = false;

	constructor(
		source: DockSource | undefined,
		private readonly options: DockGuardOptions,
	) {
		this.source = source ?? createNativeDockSource();
		this.now = options.now ?? Date.now;
		this.ttlMs = options.ttlMs ?? 120_000;
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
						surface: "dock",
						elements: snapshot.elements.map(({ id, role, label, value, actions, frame }) => ({
							id,
							role,
							label,
							value,
							actions,
							frame,
						})),
						truncated: snapshot.truncated,
						observation_token: token,
						delivery: { mode: this.options.delivery, modes: ["background", "attended"] },
					}),
				);
			} catch (error) {
				return refusalResult("dock-observe-failed", errorMessage(error));
			}
		});
	}

	act(token: string, elementId: number, action: DockAction): Promise<ToolResult> {
		return this.serial(async () => {
			const entry = this.tokens.get(token);
			this.tokens.delete(token);
			if (entry === undefined) return refusalResult("dock-token-invalid");
			if (this.now() - entry.issuedAt >= this.ttlMs) return refusalResult("dock-token-expired");
			if (!DOCK_ACTIONS.has(action)) return refusalResult("dock-action-unsupported");
			const element = entry.snapshot.elements.find((candidate) => candidate.id === elementId);
			if (element === undefined || !DOCK_ROLES.has(element.role)) return refusalResult("dock-element-not-observed");
			if (!element.actions.includes(action)) return refusalResult("dock-action-not-advertised");

			const refusal = this.policyRefusal(true);
			if (refusal !== undefined) return refusal;
			try {
				if (this.now() - entry.issuedAt >= this.ttlMs) return refusalResult("dock-token-expired");
				await this.source.act(entry.snapshot, elementId, action);
			} catch (error) {
				return {
					...textResult(
						JSON.stringify({
							actionAttempted: true,
							effect: "unverifiable",
							route: "accessibility",
							delivery: "attended",
							surface: "dock",
							message: `Dock action attempt failed; dispatch status is unknown and it will not be replayed: ${errorMessage(error)}`,
						}),
					),
					isError: true,
				};
			}

			try {
				const fresh = await this.source.read();
				const nextRefusal = this.policyRefusal(false);
				if (nextRefusal !== undefined || fresh.pid !== entry.snapshot.pid) {
					return textResult(
						JSON.stringify({
							actionDispatched: true,
							effect: "unverifiable",
							route: "accessibility",
							delivery: "attended",
							surface: "dock",
							message:
								nextRefusal === undefined
									? "Dock action dispatched; fresh context is not safely reusable."
									: "Dock action dispatched; fresh observation was not authorized.",
						}),
					);
				}
				const changed = compactFacts(fresh) !== compactFacts(entry.snapshot);
				const continuation = randomUUID();
				this.tokens.clear();
				this.tokens.set(continuation, { snapshot: fresh, issuedAt: this.now() });
				return textResult(
					JSON.stringify({
						actionDispatched: true,
						effect: changed ? "observed_change" : "unverifiable",
						route: "accessibility",
						delivery: "attended",
						surface: "dock",
						elements: fresh.elements.map(({ id, role, label, value, actions, frame }) => ({
							id,
							role,
							label,
							value,
							actions,
							frame,
						})),
						truncated: fresh.truncated,
						observation_token: continuation,
					}),
				);
			} catch (error) {
				return textResult(
					JSON.stringify({
						actionDispatched: true,
						effect: "unverifiable",
						route: "accessibility",
						delivery: "attended",
						surface: "dock",
						message: `Dock action was dispatched, but fresh state could not be read: ${errorMessage(error)}`,
					}),
				);
			}
		});
	}

	observedElements(token: string): DockSnapshot["elements"] | undefined {
		const entry = this.tokens.get(token);
		if (entry === undefined || this.now() - entry.issuedAt >= this.ttlMs) return undefined;
		return entry.snapshot.elements;
	}

	invalidate(): void {
		this.tokens.clear();
	}

	close(): void {
		this.stopped = true;
		this.invalidate();
	}

	private policyRefusal(mutation: boolean): ToolResult | undefined {
		if (this.stopped) return refusalResult("dock-session-closed");
		const stop = this.options.stopSwitch?.status();
		if (stop?.stopped === true) return refusalResult("user-stopped", describeUserStop(stop));
		if (!this.options.allowedBundleIds.includes(DOCK_BUNDLE_ID))
			return refusalResult("dock-not-approved", "Dock observation requires com.apple.dock approval.");
		const host = this.options.probeHost();
		if (!host.permissions.accessibility) return refusalResult("accessibility-permission-required");
		if (host.session.screenLocked) return refusalResult("screen-locked");
		if (mutation && (host.session.onConsole !== true || this.options.delivery !== "attended"))
			return refusalResult("dock-mutation-unavailable");
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

function compactFacts(snapshot: DockSnapshot): string {
	return JSON.stringify(
		snapshot.elements.map(({ id, role, label, value, actions }) => [id, role, label, value, actions]),
	);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

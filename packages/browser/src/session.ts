import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { BrowserTransport } from "./bridge.js";
import {
	BrowserError,
	type BrowserExpectation,
	type BrowserObservation,
	type BrowserStep,
	type ObservationLimits,
	observationSchema,
} from "./protocol.js";

const openResultSchema = z.object({ tabId: z.number().int().positive() });
const runResultSchema = z.object({
	observation: observationSchema,
	verified: z.boolean().nullable(),
	completedSteps: z.number().int().nonnegative(),
});
const defaultLimits: ObservationLimits = { maxChars: 6000, maxElements: 80, fullPage: false };

/** Tokens bind exactly one mutation to an observation and an extension connection. */
export class BrowserSession {
	private readonly tabs = new Map<
		number,
		{ observation: BrowserObservation | undefined; token: string | undefined; generation: number; busy: boolean }
	>();

	private readonly transport: BrowserTransport;

	constructor(transport: BrowserTransport) {
		this.transport = transport;
	}

	async open(url: string, signal?: AbortSignal): Promise<{ readonly tabId: number }> {
		if (signal?.aborted) throw new BrowserError("stopped", "Browser open was cancelled before tab creation");
		const generation = this.transport.generation;
		// Once creation starts, retain the result even if the caller leaves so the
		// controller can publish ownership and finish can still close the tab.
		const result = openResultSchema.parse(await this.transport.request({ method: "open", url }));
		if (generation !== this.transport.generation)
			throw new BrowserError("stale", "Extension reconnected during open");
		this.tabs.set(result.tabId, {
			observation: undefined,
			token: undefined,
			generation,
			busy: false,
		});
		return result;
	}

	async observe(tabId: number, limits = defaultLimits, full = false) {
		const tab = this.requireTab(tabId);
		if (tab.busy) throw new BrowserError("busy", "A command is already active on this tab");
		tab.busy = true;
		try {
			const observation = observationSchema.parse(
				await this.transport.request({ method: "observe", tabId, limits }),
			);
			return this.record(tabId, observation, full);
		} finally {
			tab.busy = false;
		}
	}

	async run(
		tabId: number,
		token: string,
		steps: readonly BrowserStep[],
		expect: BrowserExpectation | undefined,
		limits = defaultLimits,
	) {
		const tab = this.requireTab(tabId);
		if (tab.busy) throw new BrowserError("busy", "A command is already active on this tab");
		if (tab.token !== token || tab.observation === undefined) {
			throw new BrowserError("stale", "Observation token is stale or consumed. Observe this tab again.");
		}
		tab.token = undefined;
		tab.busy = true;
		try {
			const result = runResultSchema.parse(
				await this.transport.request({
					method: "run",
					tabId,
					revision: tab.observation.revision,
					steps,
					expect,
					limits,
				}),
			);
			return {
				...this.record(tabId, result.observation, false),
				verified: result.verified,
				completedSteps: result.completedSteps,
			};
		} finally {
			tab.busy = false;
		}
	}

	async close(tabId: number): Promise<void> {
		const tab = this.requireTab(tabId);
		if (tab.busy) throw new BrowserError("busy", "Cannot close a tab while input is active");
		tab.busy = true;
		try {
			await this.transport.request({ method: "close", tabId });
			this.tabs.delete(tabId);
		} finally {
			tab.busy = false;
		}
	}

	private requireTab(tabId: number) {
		const tab = this.tabs.get(tabId);
		if (tab === undefined) throw new BrowserError("stale", "This session does not own that tab");
		if (tab.generation !== this.transport.generation) {
			throw new BrowserError("stale", "Extension reconnected; old tab ownership and observations are invalid.");
		}
		return tab;
	}

	private record(tabId: number, observation: BrowserObservation, full: boolean) {
		const tab = this.requireTab(tabId);
		const before = tab.observation;
		const token = randomUUID();
		tab.observation = observation;
		tab.token = token;
		const base = {
			observation_token: token,
			url: observation.url,
			title: observation.title,
			truncated: observation.truncated,
		};
		if (
			full ||
			before === undefined ||
			before.url !== observation.url ||
			before.revision.split(":")[0] !== observation.revision.split(":")[0]
		) {
			return { ...base, format: "full" as const, rows: observation.rows };
		}
		const old = new Map(before.rows.map((row) => [row.ref, row]));
		const current = new Set(observation.rows.map((row) => row.ref));
		const changed = observation.rows.filter((row) => {
			const previous = old.get(row.ref);
			return previous === undefined || previous.role !== row.role || previous.name !== row.name;
		});
		const removed = before.rows.filter((row) => !current.has(row.ref)).map((row) => row.ref);
		return { ...base, format: "delta" as const, changed, removed };
	}
}

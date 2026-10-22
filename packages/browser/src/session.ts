import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { BrowserTransport } from "./bridge.js";
import {
	BrowserError,
	type BrowserExpectation,
	type BrowserFindResult,
	type BrowserObservation,
	type BrowserReadResult,
	type BrowserScreenshot,
	type BrowserStep,
	type BrowserWaitResult,
	type ObservationLimits,
	type TargetQuery,
	findResultSchema,
	observationSchema,
	readResultSchema,
	screenshotResultSchema,
	waitResultSchema,
} from "./protocol.js";

const openResultSchema = z.object({ tabId: z.number().int().positive() });
const runResultSchema = z.object({
	observation: observationSchema,
	verified: z.boolean().nullable(),
	completedSteps: z.number().int().nonnegative(),
});
const defaultLimits: ObservationLimits = {
	maxChars: 6000,
	maxElements: 80,
	fullPage: false,
	profile: "interactive",
	maxNameChars: 120,
};

type TabState = {
	observation: BrowserObservation | undefined;
	baseline: BrowserObservation | undefined;
	token: string | undefined;
	generation: number;
	busy: boolean;
};

/** Tokens bind exactly one mutation to an observation and an extension connection. */
export class BrowserSession {
	private readonly tabs = new Map<number, TabState>();

	private readonly transport: BrowserTransport;

	constructor(transport: BrowserTransport) {
		this.transport = transport;
	}

	async open(url: string, signal?: AbortSignal): Promise<{ readonly tabId: number }> {
		if (signal?.aborted) throw new BrowserError("stopped", "Browser open was cancelled before tab creation");
		const generation = this.transport.generation;
		const result = openResultSchema.parse(await this.transport.request({ method: "open", url }));
		if (generation !== this.transport.generation)
			throw new BrowserError("stale", "Extension reconnected during open");
		this.tabs.set(result.tabId, {
			observation: undefined,
			baseline: undefined,
			token: undefined,
			generation,
			busy: false,
		});
		return result;
	}

	async observe(tabId: number, limits: ObservationLimits = defaultLimits, full = false) {
		const tab = this.requireTab(tabId);
		if (tab.busy) throw new BrowserError("busy", "A command is already active on this tab");
		tab.busy = true;
		try {
			const observation = observationSchema.parse(
				await this.transport.request({ method: "observe", tabId, limits }),
			);
			return this.record(tabId, observation, limits, full);
		} finally {
			tab.busy = false;
		}
	}

	async find(tabId: number, query: TargetQuery, limit = 10) {
		const tab = this.requireTab(tabId);
		if (tab.busy) throw new BrowserError("busy", "A command is already active on this tab");
		tab.busy = true;
		try {
			const found = findResultSchema.parse(await this.transport.request({ method: "find", tabId, query, limit }));
			return this.recordFind(tabId, found);
		} finally {
			tab.busy = false;
		}
	}

	async read(tabId: number, maxChars = 8000, includeLinks = false) {
		const tab = this.requireTab(tabId);
		if (tab.busy) throw new BrowserError("busy", "A command is already active on this tab");
		tab.busy = true;
		try {
			const read = readResultSchema.parse(
				await this.transport.request({ method: "read", tabId, maxChars, includeLinks }),
			);
			const rows = (read.links ?? []).map((link) => ({
				ref: link.ref,
				role: "link",
				name: link.name,
			}));
			return this.recordRead(tabId, read, rows);
		} finally {
			tab.busy = false;
		}
	}

	async wait(
		tabId: number,
		options: { readonly text?: string; readonly selector?: string; readonly timeoutMs?: number },
		limits: ObservationLimits = defaultLimits,
	) {
		const tab = this.requireTab(tabId);
		if (tab.busy) throw new BrowserError("busy", "A command is already active on this tab");
		tab.busy = true;
		let waited: BrowserWaitResult;
		try {
			waited = waitResultSchema.parse(
				await this.transport.request({
					method: "wait",
					tabId,
					text: options.text,
					selector: options.selector,
					timeoutMs: options.timeoutMs ?? 3000,
				}),
			);
		} finally {
			tab.busy = false;
		}
		const observation = await this.observe(tabId, limits, true);
		return { ...waited, ...observation };
	}

	async screenshot(tabId: number, fullPage = false): Promise<BrowserScreenshot> {
		const tab = this.requireTab(tabId);
		if (tab.busy) throw new BrowserError("busy", "A command is already active on this tab");
		tab.busy = true;
		try {
			return screenshotResultSchema.parse(await this.transport.request({ method: "screenshot", tabId, fullPage }));
		} finally {
			tab.busy = false;
		}
	}

	async run(
		tabId: number,
		token: string,
		steps: readonly BrowserStep[],
		expect: BrowserExpectation | undefined,
		limits: ObservationLimits = defaultLimits,
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
				...this.record(tabId, result.observation, limits, false),
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

	private requireTab(tabId: number): TabState {
		const tab = this.tabs.get(tabId);
		if (tab === undefined) throw new BrowserError("stale", "This session does not own that tab");
		if (tab.generation !== this.transport.generation) {
			throw new BrowserError("stale", "Extension reconnected; old tab ownership and observations are invalid.");
		}
		return tab;
	}

	private recordFind(tabId: number, found: BrowserFindResult) {
		const token = this.store(tabId, found, found.matches, false);
		return {
			observation_token: token,
			url: found.url,
			title: found.title,
			revision: found.revision,
			truncated: found.truncated,
			matches: found.matches,
		};
	}

	private recordRead(tabId: number, read: BrowserReadResult, rows: BrowserObservation["rows"]) {
		const token = this.store(tabId, read, rows, false);
		return {
			observation_token: token,
			url: read.url,
			title: read.title,
			revision: read.revision,
			truncated: read.truncated,
			text: read.text,
			...(read.links === undefined ? {} : { links: read.links }),
		};
	}

	private store(
		tabId: number,
		result: Pick<BrowserObservation, "url" | "title" | "revision" | "truncated">,
		rows: BrowserObservation["rows"],
		updateBaseline: boolean,
	): string {
		const tab = this.requireTab(tabId);
		const token = randomUUID();
		const observation: BrowserObservation = {
			url: result.url,
			title: result.title,
			revision: result.revision,
			rows,
			truncated: result.truncated,
		};
		tab.observation = observation;
		tab.token = token;
		if (updateBaseline) tab.baseline = observation;
		return token;
	}

	private record(tabId: number, observation: BrowserObservation, limits: ObservationLimits, full: boolean) {
		const tab = this.requireTab(tabId);
		const before = tab.baseline;
		const token = randomUUID();
		tab.observation = observation;
		tab.token = token;
		tab.baseline = observation;
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
			before.revision.split(":")[0] !== observation.revision.split(":")[0] ||
			limits.profile === "all"
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

import { createHash } from "node:crypto";

export type PrefetchStatus = "parked" | "discarded" | "error";

export function decisionCacheKey(frameHash: string, questions: unknown, scope: string): string {
	const questionsHash = createHash("sha1").update(JSON.stringify(questions)).digest("hex");
	return JSON.stringify([scope, frameHash, questionsHash]);
}

/** One bounded entry and one speculative request, owned by a single decider. */
export class DecisionCache<T> {
	private entry: { readonly key: string; readonly value: T; readonly storedAt: number } | undefined;
	private pending: Promise<void> | undefined;

	constructor(
		private readonly now: () => number = Date.now,
		private readonly onPrefetch?: (status: PrefetchStatus) => void,
	) {}

	get(key: string): T | undefined {
		const entry = this.entry;
		return entry?.key === key && this.now() - entry.storedAt < 2_000 ? entry.value : undefined;
	}

	put(key: string, value: T): void {
		this.entry = { key, value, storedAt: this.now() };
	}

	private notify(status: PrefetchStatus): void {
		try {
			this.onPrefetch?.(status);
		} catch {
			// Observer failures must not reject speculation or change its cache outcome.
		}
	}

	prefetch(key: string, load: () => Promise<T>, isCurrent: () => boolean): Promise<void> {
		if (this.pending !== undefined) {
			return this.pending;
		}
		// The microtask also turns a synchronous loader throw into a handled speculative failure.
		this.pending = Promise.resolve()
			.then(load)
			.then((value) => {
				if (!isCurrent()) {
					this.notify("discarded");
					return;
				}
				this.put(key, value);
				this.notify("parked");
			})
			.catch(() => {
				// Speculation must never fail the action or leave an unhandled rejection.
				this.notify("error");
			})
			.finally(() => {
				this.pending = undefined;
			});
		return this.pending;
	}
}

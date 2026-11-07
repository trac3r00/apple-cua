import { currentCursorIdentity } from "../computer/cursor-scope.js";

/**
 * The latest observation of each app. An app that `shared` accepts (an opencua-owned surface) keeps one observation per
 * acting cursor, so agents sharing that window do not replace each other's observation.
 */
const MAX_ENTRIES = 256;

export class CursorKeyedObservations<T> {
	private readonly entries = new Map<number | string, { readonly pid: number; readonly value: T }>();

	constructor(private readonly shared: (pid: number) => boolean) {}

	private key(pid: number): number | string {
		const identity = currentCursorIdentity();
		return identity !== undefined && this.shared(pid) ? `${pid}:${identity}` : pid;
	}

	get(pid: number): T | undefined {
		return this.entries.get(this.key(pid))?.value;
	}

	/** Keeps the most recent entries only, so cursors that came and went do not pile up. */
	set(pid: number, value: T): void {
		const key = this.key(pid);
		this.entries.delete(key);
		this.entries.set(key, { pid, value });
		const oldest = this.entries.keys().next();
		if (this.entries.size > MAX_ENTRIES && oldest.done !== true) this.entries.delete(oldest.value);
	}

	delete(pid: number): void {
		this.entries.delete(this.key(pid));
	}

	/** Every app that has an observation, whichever cursor made it. */
	pids(): number[] {
		return [...new Set([...this.entries.values()].map((entry) => entry.pid))];
	}

	clear(): void {
		this.entries.clear();
	}
}

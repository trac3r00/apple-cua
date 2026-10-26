import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveStateDir } from "./stop-switch.js";

const LOCK_FILE_NAME = "input-lock.json";
const POLL_MILLISECONDS = 8;
const DEFAULT_WAIT_MILLISECONDS = 1_500;

export interface InputLockRecord {
	readonly pid: number;
	readonly startedAt: string;
}

function lockPath(stateDir: string): string {
	return join(stateDir, LOCK_FILE_NAME);
}

function readRecord(path: string): InputLockRecord | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (typeof parsed !== "object" || parsed === null) {
			return undefined;
		}
		const record = parsed as Partial<InputLockRecord>;
		if (typeof record.pid !== "number" || !Number.isInteger(record.pid) || record.pid <= 0) {
			return undefined;
		}
		return { pid: record.pid, startedAt: typeof record.startedAt === "string" ? record.startedAt : "" };
	} catch {
		return undefined;
	}
}

function processAlive(pid: number): boolean {
	if (pid === process.pid) {
		return true;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function claim(stateDir: string, path: string): void {
	mkdirSync(stateDir, { recursive: true });
	const temporary = `${path}.${process.pid}.${randomSuffix()}.tmp`;
	writeFileSync(temporary, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
	renameSync(temporary, path);
}

let suffixCounter = 0;

function randomSuffix(): string {
	suffixCounter += 1;
	return `${Date.now().toString(36)}${suffixCounter}`;
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolvePromise) => {
		setTimeout(resolvePromise, milliseconds);
	});
}

/**
 * A machine-wide input lock, to the stop switch what the queue is to one process: every
 * apple-cua process takes the same file before it posts pointer or keyboard events, so two
 * agents cannot interleave keystrokes on one screen. A holder that died leaves a stale record
 * named by a pid that no longer exists, and the next taker steals it. Shell tools that bypass
 * apple-cua do not consult this file; the switch, the allowlist and OS permissions stay the
 * answer for those.
 */
export class InputLock {
	readonly path: string;
	private depth = 0;

	constructor(stateDir: string = resolveStateDir()) {
		this.path = lockPath(stateDir);
	}

	/** True when another live process holds the lock right now. */
	heldByOther(): boolean {
		const record = readRecord(this.path);
		if (record === undefined || record.pid === process.pid) {
			return false;
		}
		return processAlive(record.pid);
	}

	/**
	 * Take the lock, waiting up to the budget for a live foreign holder. Re-entrant on this pid.
	 * False means a live foreign holder kept it past the budget; the caller must not send input.
	 */
	async acquire(waitMilliseconds: number = DEFAULT_WAIT_MILLISECONDS): Promise<boolean> {
		if (this.depth > 0) {
			this.depth += 1;
			return true;
		}
		const started = Date.now();
		for (;;) {
			const record = readRecord(this.path);
			if (record === undefined || record.pid === process.pid || !processAlive(record.pid)) {
				claim(resolveStateDir(), this.path);
				this.depth = 1;
				return true;
			}
			const waited = Date.now() - started;
			if (waited >= waitMilliseconds) {
				return false;
			}
			await delay(Math.min(POLL_MILLISECONDS, waitMilliseconds - waited));
		}
	}

	release(): void {
		if (this.depth === 0) {
			return;
		}
		this.depth -= 1;
		if (this.depth === 0 && existsSync(this.path)) {
			const record = readRecord(this.path);
			if (record === undefined || record.pid === process.pid) {
				rmSync(this.path, { force: true });
			}
		}
	}

	/** Run one input burst under the lock. Throws `input-lock-busy` when a foreign holder outwaits the budget. */
	async run<T>(burst: () => Promise<T>, waitMilliseconds?: number): Promise<T> {
		const taken = await this.acquire(waitMilliseconds);
		if (!taken) {
			throw new Error("input-lock-busy: another apple-cua process holds the machine input lock");
		}
		try {
			return await burst();
		} finally {
			this.release();
		}
	}
}

export function defaultInputLock(): InputLock {
	return new InputLock();
}

export function homeStateDir(): string {
	return join(homedir(), ".apple-cua");
}

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InputLock } from "./input-lock.js";

let stateDir: string | undefined;

function freshLock(): InputLock {
	const dir = join(import.meta.dirname, `input-lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	stateDir = dir;
	mkdirSync(dir, { recursive: true });
	return new InputLock(dir);
}

afterEach(() => {
	if (stateDir !== undefined) {
		rmSync(stateDir, { recursive: true, force: true });
		stateDir = undefined;
	}
});

describe("#given a free lock #when it is acquired and released #then the file appears and disappears", () => {
	it("holds and releases the machine-wide lock", async () => {
		const lock = freshLock();
		expect(lock.heldByOther()).toBe(false);
		expect(await lock.acquire(0)).toBe(true);
		expect(lock.heldByOther()).toBe(false);
		lock.release();
		expect(await lock.acquire(0)).toBe(true);
		lock.release();
	});

	it("is re-entrant on the same process until every holder releases", async () => {
		const lock = freshLock();
		expect(await lock.acquire(0)).toBe(true);
		expect(await lock.acquire(0)).toBe(true);
		lock.release();
		expect(await lock.acquire(0)).toBe(true);
		lock.release();
		lock.release();
	});
});

describe("#given a live foreign holder #when the budget runs out #then the acquisition reports busy", () => {
	it("refuses input while another live process holds the lock", async () => {
		const lock = freshLock();
		writeFileSync(join(lock.path), `${JSON.stringify({ pid: 1, startedAt: new Date().toISOString() })}\n`);
		expect(lock.heldByOther()).toBe(true);
		expect(await lock.acquire(0)).toBe(false);
		await expect(lock.run(async () => 1, 0)).rejects.toThrow("input-lock-busy");
	});

	it("waits for a live holder and takes over when it releases", async () => {
		const lock = freshLock();
		writeFileSync(join(lock.path), `${JSON.stringify({ pid: 1, startedAt: new Date().toISOString() })}\n`);
		const stealing = lock.run(async () => "taken", 2_000);
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 30));
		rmSync(lock.path, { force: true });
		await expect(stealing).resolves.toBe("taken");
		lock.release();
	});
});

describe("#given a stale holder #when the pid is no longer alive #then the lock is stolen at once", () => {
	it("steals the record of a dead process", async () => {
		const lock = freshLock();
		writeFileSync(join(lock.path), `${JSON.stringify({ pid: -1, startedAt: "bogus" })}\n`);
		expect(await lock.acquire(0)).toBe(true);
		lock.release();
	});

	it("steals a record whose pid has exited", async () => {
		const lock = freshLock();
		writeFileSync(
			join(lock.path),
			`${JSON.stringify({ pid: 2_000_000_000, startedAt: new Date().toISOString() })}\n`,
		);
		expect(await lock.acquire(0)).toBe(true);
		lock.release();
	});

	it("treats a malformed lock file as free", async () => {
		const lock = freshLock();
		writeFileSync(join(lock.path), "not-json");
		expect(lock.heldByOther()).toBe(false);
		expect(await lock.acquire(0)).toBe(true);
		lock.release();
	});
});

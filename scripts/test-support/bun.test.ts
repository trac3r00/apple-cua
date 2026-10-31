import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "@apple-cua/test-support";

afterEach(() => vi.useRealTimers());

it("#given an async fake-timer callback #when virtual time advances #then its continuation settles before the result", async () => {
	vi.useFakeTimers();
	let completed = false;
	let resolveTimer: (() => void) | undefined;
	const timer = new Promise<void>((resolve) => {
		resolveTimer = resolve;
	});
	setTimeout(async () => {
		await Promise.resolve();
		completed = true;
		resolveTimer?.();
	}, 1);
	await vi.advanceTimersByTimeAsync(1);
	await timer;
	expect(completed).toBe(true);
});

it("#given an evaluated module with a mocked dependency #when modules reset #then the next import is fresh and still mocked", async () => {
	const directory = realpathSync(mkdtempSync(join(tmpdir(), "apple-cua-reset-modules-")));
	try {
		writeFileSync(join(directory, "dependency.ts"), 'export const source = (): string => "real";\n');
		writeFileSync(
			join(directory, "subject.ts"),
			'import { source } from "./dependency.ts";\nexport const instance = Symbol("subject");\nexport const read = (): string => source();\n',
		);
		vi.mock(join(directory, "dependency.ts"), () => ({ source: () => "mocked" }));
		const first: { readonly instance: symbol } = await import(join(directory, "subject.ts"));
		vi.resetModules();
		const second: { readonly instance: symbol; readonly read: () => string } = await import(
			join(directory, "subject.ts")
		);

		expect(second.instance).not.toBe(first.instance);
		expect(second.read()).toBe("mocked");
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

it("#given a partial module mock #when a dependent imports omitted exports #then it links and reads them as undefined", async () => {
	const directory = realpathSync(mkdtempSync(join(tmpdir(), "apple-cua-partial-mock-")));
	try {
		writeFileSync(join(directory, "more.ts"), 'export const more = (): string => "real-more";\n');
		writeFileSync(
			join(directory, "dependency.ts"),
			'export * from "./more.ts";\nexport const present = (): string => "real";\nexport const absent = (): string => "real-absent";\n',
		);
		writeFileSync(
			join(directory, "subject.ts"),
			'import { absent, more, present } from "./dependency.ts";\nexport const shape = (): string[] => [present(), typeof absent, typeof more];\n',
		);
		vi.mock(join(directory, "dependency.ts"), () => ({ present: () => "mocked" }));
		const subject: { readonly shape: () => readonly string[] } = await import(join(directory, "subject.ts"));

		expect(subject.shape()).toEqual(["mocked", "undefined", "undefined"]);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

it("#given timers scheduled by async continuations #when fake time advances asynchronously #then each continuation runs in order", async () => {
	vi.useFakeTimers();
	const fired: number[] = [];
	const loop = (async () => {
		for (let round = 1; round <= 3; round++) {
			await new Promise((resolve) => setTimeout(resolve, 10));
			fired.push(Date.now());
		}
	})();
	const start = Date.now();
	await vi.advanceTimersByTimeAsync(25);
	expect(fired.map((time) => time - start)).toEqual([10, 20]);
	await vi.runAllTimersAsync();
	await loop;
	expect(fired.map((time) => time - start)).toEqual([10, 20, 30]);
});

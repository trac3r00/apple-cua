import { type Mock, vi as bunVi, jest, mock } from "bun:test";
import { readFileSync, realpathSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const shimPath = realpathSync(fileURLToPath(import.meta.url));

const environment = new Map<string, string | undefined>();
const globals = new Map<PropertyKey, PropertyDescriptor | undefined>();

function stubEnv(name: string, value: string | undefined): void {
	if (!environment.has(name)) environment.set(name, process.env[name]);
	if (value === undefined) Reflect.deleteProperty(process.env, name);
	else process.env[name] = value;
}

function unstubAllEnvs(): void {
	for (const [name, value] of environment) {
		if (value === undefined) Reflect.deleteProperty(process.env, name);
		else process.env[name] = value;
	}
	environment.clear();
}

function stubGlobal(name: PropertyKey, value: unknown): void {
	if (!globals.has(name)) globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
	Object.defineProperty(globalThis, name, {
		configurable: true,
		enumerable: true,
		writable: true,
		value,
	});
}

function unstubAllGlobals(): void {
	for (const [name, descriptor] of globals) {
		if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
		else Object.defineProperty(globalThis, name, descriptor);
	}
	globals.clear();
}

const exportScanner = new Bun.Transpiler({ loader: "tsx" });
const STAR_EXPORT = /^export \* from ["']([^"']+)["']/gm;

/** Names a module exports, read from source so the module itself is never evaluated. */
function exportNamesOf(resolved: string, seen: Set<string>): readonly string[] {
	if (!resolved.startsWith("/")) return Object.keys(require(resolved));
	if (seen.has(resolved)) return [];
	seen.add(resolved);
	const source = readFileSync(resolved, "utf8");
	const names = new Set(exportScanner.scan(source).exports.filter((name) => name !== "default"));
	for (const match of source.matchAll(STAR_EXPORT)) {
		const target = match[1];
		if (target === undefined) continue;
		for (const name of exportNamesOf(Bun.resolveSync(target, dirname(resolved)), seen)) {
			if (name !== "default") names.add(name);
		}
	}
	return [...names];
}

function callerDirectory(): string {
	for (const frame of (new Error().stack ?? "").split("\n").slice(1)) {
		const location = /\((\/[^)]+?):\d+:\d+\)$|at (\/\S+?):\d+:\d+$/.exec(frame.trim());
		const file = location?.[1] ?? location?.[2];
		if (file !== undefined && !file.endsWith("/scripts/test-support/bun.ts")) return dirname(file);
	}
	throw new Error("vi.mock could not determine the calling test file");
}

function completeExports(names: readonly string[], provided: unknown, builtin: boolean): unknown {
	if (typeof provided === "object" && provided !== null) {
		for (const name of names) if (!(name in provided)) Reflect.set(provided, name, undefined);
		// A builtin's default export is the module object itself, which dependencies default-import.
		if (builtin && !("default" in provided)) Reflect.set(provided, "default", provided);
	}
	return provided;
}

/**
 * Vitest-compatible module mock: the specifier resolves from the calling test file, and exports the factory omits
 * read as undefined instead of failing to link, so a partial factory replaces the module as it did under Vitest.
 */
function mockModule(specifier: string, factory: () => unknown): void {
	const directory = callerDirectory();
	let resolved: string;
	try {
		resolved = Bun.resolveSync(specifier, directory);
	} catch {
		// Vitest accepts a mock for a module nothing can import; it stays a no-op rather than failing the file.
		return;
	}
	const names = exportNamesOf(resolved, new Set());
	const builtin = !resolved.startsWith("/");
	mock.module(resolved, () => {
		const provided = factory();
		return provided instanceof Promise
			? provided.then((value: unknown) => completeExports(names, value, builtin))
			: completeExports(names, provided, builtin);
	});
}

const realSetImmediate = setImmediate;
const TIMER_LOOP_LIMIT = 10_000;

/** One real event-loop turn, so continuations of a fired fake timer run before the next one, as under Vitest. */
function settle(): Promise<void> {
	return new Promise((resolve) => {
		realSetImmediate(resolve);
	});
}

/** Vitest's advanceTimersByTimeAsync: fake time moves in 1 ms steps while timers are pending, settling between. */
async function advanceTimersByTimeAsync(milliseconds: number): Promise<void> {
	// Bun clamps zero-delay timers to 1 ms, so 1 ms steps also run them inside the window, and Bun's own zero
	// advance runs the timers Vitest treats as due now.
	await settle();
	if (milliseconds === 0) {
		jest.advanceTimersByTime(0);
		await settle();
		return;
	}
	let remaining = milliseconds;
	while (remaining > 0) {
		if (bunVi.getTimerCount() === 0) {
			jest.advanceTimersByTime(remaining);
			break;
		}
		const step = Math.min(1, remaining);
		jest.advanceTimersByTime(step);
		remaining -= step;
		await settle();
	}
	await settle();
}

/** Vitest's runAllTimersAsync: run timers one at a time, settling between, until none remain. */
async function runAllTimersAsync(): Promise<void> {
	for (let fired = 0; fired < TIMER_LOOP_LIMIT; fired++) {
		await settle();
		if (bunVi.getTimerCount() === 0) return;
		jest.advanceTimersToNextTimer();
	}
	throw new Error(`Aborting after running ${TIMER_LOOP_LIMIT} timers, assuming an infinite loop`);
}

/** The Node binary. Under Vitest, which ran on Node, tests started the shipped Node CLI with process.execPath. */
export function nodeExecutable(): string {
	const found = Bun.which("node");
	if (found === null) throw new Error("node is not on PATH; the shipped CLI runs on Node");
	return found;
}

/** The function shape Bun's Mock accepts, read from mock() itself. */
type MockableFunction = NonNullable<Parameters<typeof mock>[0]>;

function isMockFunction<T extends MockableFunction>(value: T): value is T & Mock<T> {
	return "mock" in value && typeof value.mock === "object" && value.mock !== null;
}

/** fetch's call signature without the preconnect member Bun's fetch type carries. */
export type FetchHandler = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** A fetch test double: the handler gains Bun's own preconnect, so it satisfies typeof fetch. */
export function fetchDouble(handler: FetchHandler): typeof fetch {
	return Object.assign(handler, { preconnect: fetch.preconnect });
}

/** A fixture lookup the test requires; Bun's typed matchers reject a possibly undefined expectation. */
export function defined<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("expected the fixture lookup to hold a value");
	return value;
}

/**
 * Vitest's deferred `const assertion = expect(promise).rejects...` form. Bun evaluates `.rejects` and `.resolves`
 * by blocking until the promise settles, which deadlocks a test that must act before settlement, so the same assertion
 * runs once the promise has settled.
 */
export async function whenSettled<T>(promise: Promise<T>, assertion: (settled: Promise<T>) => unknown): Promise<void> {
	await promise.then(
		() => undefined,
		() => undefined,
	);
	await assertion(promise);
}

/**
 * Bun 1.4.4's toMatchObject writes the expected asymmetric matchers (expect.any and friends) into the received value.
 * Match against a copy when the test reads that value again afterwards.
 */
export function copyForMatch<T>(value: T): T {
	return structuredClone(value);
}

/**
 * Forget every evaluated source module so the next import evaluates it again, like Vitest's resetModules.
 * Registered module mocks stay in place; test files, this helper and installed packages are kept.
 */
function resetModules(): void {
	for (const key of Object.keys(require.cache)) {
		if (
			key.startsWith("/") &&
			key !== shimPath &&
			!key.includes("/node_modules/") &&
			!/\.test\.[cm]?[jt]s$/.test(key)
		) {
			Reflect.deleteProperty(require.cache, key);
		}
	}
}

export const vi = Object.assign(bunVi, {
	hoisted<T>(factory: () => T): T {
		return factory();
	},
	mocked<T extends MockableFunction>(value: T): T & Mock<T> {
		if (!isMockFunction(value)) throw new TypeError("vi.mocked expects a mock function");
		return value;
	},
	setSystemTime(value: Date | number): void {
		jest.setSystemTime(value);
	},
	advanceTimersByTimeAsync,
	runAllTimersAsync,
	stubEnv,
	unstubAllEnvs,
	stubGlobal,
	unstubAllGlobals,
	resetModules,
	mock: mockModule,
});

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const nativeDirectory = fileURLToPath(new URL("../../native/", import.meta.url));
let scratch: string;
let binary: string;
const supportedSettings = {
	defaultApplicationBehavior: "observe",
	defaultURLBehavior: "observe",
	observePrivateBrowsing: true,
	rules: [],
};

beforeAll(async () => {
	scratch = await mkdtemp(join(nativeDirectory, ".history-native-test-"));
	binary = join(scratch, "history-native");
	try {
		const compiler = Bun.spawn(
			[
				"clang",
				"-fobjc-arc",
				"-Wall",
				"-Wextra",
				"-Werror",
				join(nativeDirectory, "test/history-native.m"),
				"-framework",
				"AppKit",
				"-framework",
				"ApplicationServices",
				"-framework",
				"Carbon",
				"-o",
				binary,
			],
			{ stdout: "pipe", stderr: "pipe" },
		);
		const [exitCode, stdout, stderr] = await Promise.all([
			compiler.exited,
			new Response(compiler.stdout).text(),
			new Response(compiler.stderr).text(),
		]);
		expect({ exitCode, stdout, stderr }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
	} catch (error) {
		await rm(scratch, { recursive: true, force: true });
		throw error;
	}
}, 30_000);

afterAll(async () => {
	if (scratch !== undefined) {
		await rm(scratch, { recursive: true, force: true });
	}
});

async function runNative(mode: string, root: string) {
	const child = Bun.spawn([binary, mode, root], {
		env: { ...process.env, OPENCUA_STATE_DIR: root },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
	expect(stdout).toMatch(/^\d+\n$/);
	return Number(stdout.trim());
}

describe("#given native retention #when pruning offline #then only expired segment directories are removed", () => {
	it("prunes expired history on the timer even while capture is paused", async () => {
		const root = await mkdtemp(join(scratch, "paused-retention-"));
		try {
			const historyRoot = join(root, "cua-history");
			const segments = join(historyRoot, "segments");
			await mkdir(join(segments, "2026-11-01T05-40-00Z"), { recursive: true });
			await mkdir(join(segments, "2026-11-01T05-50-00Z"));
			await writeFile(join(historyRoot, "state.json"), JSON.stringify({ state: "paused" }));
			await writeFile(join(historyRoot, "settings.json"), JSON.stringify(supportedSettings));

			expect(await runNative("tick", root)).toBe(0);
			expect(await readdir(segments)).toEqual(["2026-11-01T05-50-00Z"]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("preserves unrelated entries and the exact retention boundary", async () => {
		const root = await mkdtemp(join(scratch, "prune-"));
		try {
			const segments = join(root, "segments");
			const keepDirectories = [
				"x",
				"2026-10-31T00-00-00Z-backup",
				"2026-02-30T00-00-00Z",
				"2026-11-01T05-50-00Z",
				"2026-11-01T06-00-00Z",
				"2026-11-01T12-00-00Z",
			];
			await mkdir(segments);
			for (const entry of [...keepDirectories, "2026-11-01T05-40-00Z"]) {
				await mkdir(join(segments, entry));
			}
			const keepFiles = [".DS_Store", "2026-10-31T00-00-00Z"];
			for (const entry of keepFiles) {
				await writeFile(join(segments, entry), "unrelated");
			}
			const target = join(root, "unrelated");
			await mkdir(target);
			const link = "2026-10-31T00-10-00Z";
			await symlink(target, join(segments, link));

			await runNative("prune", root);

			expect((await readdir(segments)).sort()).toEqual([...keepDirectories, ...keepFiles, link].sort());
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("#given persisted native state #when launching offline #then pause survives restart", () => {
	it.each(["paused", "running", "missing"])("preserves the %s startup contract", async (state) => {
		const root = await mkdtemp(join(scratch, "startup-"));
		try {
			const historyRoot = join(root, "cua-history");
			await mkdir(historyRoot);
			await writeFile(join(historyRoot, "settings.json"), JSON.stringify(supportedSettings));
			if (state !== "missing") {
				await writeFile(join(historyRoot, "state.json"), JSON.stringify({ state }));
			}

			await runNative("startup", root);

			const result: unknown = JSON.parse(await readFile(join(historyRoot, "state.json"), "utf8"));
			expect(result).toMatchObject({ state: state === "paused" ? "paused" : "running" });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

describe("#given unsupported native privacy rules #when starting or resuming #then capture is blocked", () => {
	it("pauses an active recorder when private-browsing exclusion is enabled", async () => {
		const root = await mkdtemp(join(scratch, "revoke-"));
		try {
			const historyRoot = join(root, "cua-history");
			await mkdir(historyRoot);
			await writeFile(join(historyRoot, "settings.json"), JSON.stringify(supportedSettings));
			await writeFile(
				join(root, "next-settings.json"),
				JSON.stringify({ ...supportedSettings, observePrivateBrowsing: false }),
			);

			expect(await runNative("revoke", root)).toBe(1);
			const state: unknown = JSON.parse(await readFile(join(historyRoot, "state.json"), "utf8"));
			expect(state).toMatchObject({
				state: "paused",
				error: "Native capture cannot enforce URL or private-browsing exclusions.",
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it.each([
		undefined,
		{},
		{ defaultURLBehavior: "observe", observePrivateBrowsing: false, rules: [] },
		{ defaultURLBehavior: "do_not_observe", observePrivateBrowsing: true, rules: [] },
		{
			defaultURLBehavior: "observe",
			observePrivateBrowsing: true,
			rules: [{ scope: "url", urlDomain: "example.com", behavior: "do_not_observe" }],
		},
	])("does not request an event tap for policy %j", async (settings) => {
		const root = await mkdtemp(join(scratch, "policy-"));
		try {
			const historyRoot = join(root, "cua-history");
			await mkdir(historyRoot);
			if (settings !== undefined) {
				await writeFile(join(historyRoot, "settings.json"), JSON.stringify(settings));
			}

			expect(await runNative("policy", root)).toBe(0);
			const state: unknown = JSON.parse(await readFile(join(historyRoot, "state.json"), "utf8"));
			expect(state).toMatchObject({
				state: "paused",
				error: "Native capture cannot enforce URL or private-browsing exclusions.",
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

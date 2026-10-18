import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { connectionToken, readConnection, writeConnection } from "./connection.js";

describe("browser connection config", () => {
	const directories: string[] = [];

	afterEach(async () => {
		await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
	});

	async function isolatedDirectory(): Promise<string> {
		const directory = await mkdtemp(join(tmpdir(), "apple-cua-connection-"));
		directories.push(directory);
		return directory;
	}

	it("#given an isolated state directory #when writing and reading config #then roundtrips with private permissions", async () => {
		const stateDir = join(await isolatedDirectory(), "new-state");
		const connection = { port: 4312, token: "a".repeat(64) };

		await writeConnection(connection, stateDir);

		expect(await readConnection(stateDir)).toEqual(connection);
		expect((await stat(stateDir)).mode & 0o777).toBe(0o700);
		expect((await stat(join(stateDir, "browser-connection.json"))).mode & 0o777).toBe(0o600);
	});

	it("#given a permissive existing directory #when writing config #then restricts directory and connection permissions", async () => {
		const stateDir = join(await isolatedDirectory(), "existing-state");
		await mkdir(stateDir);
		await chmod(stateDir, 0o755);
		await writeFile(join(stateDir, "unrelated"), "keep");

		await writeConnection({ port: 4312, token: "c".repeat(64) }, stateDir);

		expect((await stat(stateDir)).mode & 0o777).toBe(0o700);
		expect((await stat(join(stateDir, "browser-connection.json"))).mode & 0o777).toBe(0o600);
		expect(await readFile(join(stateDir, "unrelated"), "utf8")).toBe("keep");
	});

	it("#given a persisted connection #when requesting its token #then reuses the stored token", async () => {
		const stateDir = await isolatedDirectory();
		const connection = { port: 4312, token: "b".repeat(64) };
		await writeConnection(connection, stateDir);

		expect(await connectionToken(stateDir)).toBe(connection.token);
	});

	it("#given no connection file #when requesting a token #then returns fresh 64-character hex tokens", async () => {
		const stateDir = await isolatedDirectory();

		const firstToken = await connectionToken(stateDir);
		const secondToken = await connectionToken(stateDir);

		expect(firstToken).toMatch(/^[0-9a-f]{64}$/);
		expect(secondToken).toMatch(/^[0-9a-f]{64}$/);
		expect(secondToken).not.toBe(firstToken);
	});

	it("#given malformed connection JSON #when reading config #then rejects instead of replacing it", async () => {
		const stateDir = await isolatedDirectory();
		const path = join(stateDir, "browser-connection.json");
		await writeFile(path, JSON.stringify({ port: 0, token: "invalid" }));

		await expect(readConnection(stateDir)).rejects.toThrow();
		await expect(connectionToken(stateDir)).rejects.toThrow();
		expect(await readFile(path, "utf8")).toBe(JSON.stringify({ port: 0, token: "invalid" }));
	});
});

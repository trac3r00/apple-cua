import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { nodeExecutable } from "@apple-cua/test-support";
import { execa } from "execa";

const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));

describe("#given Node type stripping #when history commands load from source #then lazy imports resolve", () => {
	it("runs the disabled digest without a model call", async () => {
		const directory = await mkdtemp(join(tmpdir(), "history-source-digest-"));
		try {
			const result = await execa(nodeExecutable(), ["--experimental-strip-types", cli, "history", "digest"], {
				env: { ...process.env, APPLE_CUA_STATE_DIR: directory },
				timeout: 15_000,
			});
			expect(JSON.parse(result.stdout)).toEqual({ state: "disabled" });
			const status: unknown = JSON.parse(
				await readFile(join(directory, "cua-history", "automation-status.json"), "utf8"),
			);
			expect(status).toMatchObject({
				state: "disabled",
			});
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}, 20_000);

	it("serves and closes the source history UI without opening a browser", async () => {
		const directory = await mkdtemp(join(tmpdir(), "history-source-ui-"));
		const child = execa(
			nodeExecutable(),
			["--experimental-strip-types", cli, "history", "open", "--no-open", "--skills-dir", join(directory, "skills")],
			{
				env: { ...process.env, APPLE_CUA_STATE_DIR: directory },
				timeout: 15_000,
				reject: false,
			},
		);
		try {
			if (child.stdout === null) throw new Error("The history command has no stdout.");
			const lines = createInterface({ input: child.stdout });
			let url: string | undefined;
			try {
				for await (const line of lines) {
					url = line;
					break;
				}
			} finally {
				lines.close();
			}
			if (url === undefined) throw new Error(`History did not start: ${(await child).stderr}`);
			expect(new URL(url).hostname).toBe("127.0.0.1");
			const timeline = await fetch(new URL("api/timeline", url));
			expect(await timeline.json()).toEqual({ entries: [], state: "stopped" });
			const closed = await fetch(new URL("api/close", url), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "{}",
			});
			expect(await closed.json()).toEqual({ closed: true });
			expect((await child).exitCode).toBe(0);
		} finally {
			child.kill("SIGTERM");
			await child;
			await rm(directory, { recursive: true, force: true });
		}
	}, 20_000);
});

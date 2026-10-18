import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { closeSync, lstatSync, mkdirSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { subscribeWindow } from "./window-event.mjs";

test(
	"#given a cold fixture app #when subscribing before launch #then cancellation ends the observer",
	{ timeout: 20000 },
	async () => {
		const sharedRoot = "/tmp/cua-bench";
		mkdirSync(sharedRoot, { recursive: true });
		assert.equal(lstatSync(sharedRoot).isSymbolicLink(), false);
		const lock = openSync(join(sharedRoot, ".run.lock"), "wx");
		const directory = mkdtempSync(join(tmpdir(), "window-event-test-"));
		let observation;
		try {
			const binary = process.env.BENCH_WINDOW_OBSERVER_BINARY ?? join(directory, "window-event");
			if (!process.env.BENCH_WINDOW_OBSERVER_BINARY) {
				const compiler = spawn(
					"swiftc",
					[fileURLToPath(new URL("./window-event.swift", import.meta.url)), "-o", binary],
					{ stdio: "inherit", timeout: 15000 },
				);
				const [code] = await once(compiler, "exit");
				assert.equal(code, 0);
			}
			observation = await subscribeWindow(binary, "never-created.txt", false, "dev.apple-cua.bench.unlaunched-test");
			observation.cancel();
			await assert.rejects(observation.ready);
		} finally {
			observation?.cancel();
			rmSync(directory, { recursive: true });
			closeSync(lock);
			rmSync(join(sharedRoot, ".run.lock"));
		}
	},
);

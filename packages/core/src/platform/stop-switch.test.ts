import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { STATE_DIR_ENV, StopSwitch, describeUserStop, resolveStateDir } from "./stop-switch.js";

const directories: string[] = [];

function temporaryDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "apple-cua-stop-"));
	directories.push(directory);
	return directory;
}

afterEach(() => {
	for (const directory of directories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("StopSwitch #given a state directory", () => {
	it("#when nothing was stopped #then status is not stopped", () => {
		expect(new StopSwitch(temporaryDirectory()).status()).toEqual({ stopped: false });
	});

	it("#when stopped #then status reports reason, source and time, and leaves no temp file", () => {
		const directory = join(temporaryDirectory(), "nested", "state");
		const stopSwitch = new StopSwitch(directory);

		const written = stopSwitch.stop("because", "cli");
		const status = stopSwitch.status();

		expect(status).toEqual({ stopped: true, stoppedAt: written.stoppedAt, reason: "because", source: "cli" });
		expect(Number.isNaN(Date.parse(written.stoppedAt))).toBe(false);
		expect(readdirSync(directory)).toEqual(["stop.json"]);
	});

	it("#when a second switch shares the directory #then it obeys the same stop", () => {
		const directory = temporaryDirectory();
		new StopSwitch(directory).stop("shared", "api");

		expect(new StopSwitch(directory).status()).toMatchObject({ stopped: true, reason: "shared", source: "api" });
	});

	it("#when resumed #then status clears and resume reports whether a stop was in force", () => {
		const stopSwitch = new StopSwitch(temporaryDirectory());
		stopSwitch.stop("x", "chord");

		expect(stopSwitch.resume()).toBe(true);
		expect(stopSwitch.status()).toEqual({ stopped: false });
		expect(stopSwitch.resume()).toBe(false);
	});

	it("#when the stop file is malformed #then it counts as stopped", () => {
		const directory = temporaryDirectory();
		mkdirSync(directory, { recursive: true });
		writeFileSync(join(directory, "stop.json"), "{not json");
		const stopSwitch = new StopSwitch(directory);

		expect(stopSwitch.status()).toMatchObject({ stopped: true, reason: "malformed stop file" });
		writeFileSync(join(directory, "stop.json"), JSON.stringify({ stoppedAt: "x", reason: "r", source: "nope" }));
		expect(stopSwitch.status()).toMatchObject({ stopped: true, reason: "malformed stop file" });
	});
});

describe("resolveStateDir #given the environment", () => {
	it("#when APPLE_CUA_STATE_DIR is set #then it wins; otherwise the home default applies", () => {
		expect(resolveStateDir({ [STATE_DIR_ENV]: "/tmp/custom" })).toBe("/tmp/custom");
		expect(resolveStateDir({})).toMatch(/\.apple-cua$/);
	});
});

describe("describeUserStop #given a stop #when described #then it tells the agent not to retry", () => {
	it("names the source, the time and the resume command", () => {
		const message = describeUserStop({ stopped: true, stoppedAt: "T", reason: "r", source: "chord" });

		expect(message).toContain("chord at T");
		expect(message).toContain("apple-cua resume");
	});
});

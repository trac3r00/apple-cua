import { describe, expect, it } from "bun:test";
import { surfaceBinaryPath } from "./owned-surfaces.js";

describe("#given the committed opencua-surface binary #when its cursor multiplexer self-test runs #then interleaved cursors keep valid strokes", () => {
	it("passes strokes, context-click replay and hover cases", async () => {
		const run = Bun.spawn([surfaceBinaryPath(), "--self-test"], { stdout: "pipe", stderr: "pipe" });
		const [code, stdout, stderr] = await Promise.all([
			run.exited,
			new Response(run.stdout).text(),
			new Response(run.stderr).text(),
		]);
		expect(stderr).toBe("");
		expect(stdout.trim()).toBe("SELF-TEST OK");
		expect(code).toBe(0);
	});
});

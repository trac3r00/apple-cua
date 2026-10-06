import type { HostCapabilities } from "@apple-cua/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { selfCheckReport } from "./self-check.js";

const HOST_WITHOUT_ACCESSIBILITY: HostCapabilities = {
	permissions: { accessibility: false, screenRecording: true },
	session: { screenLocked: false, onConsole: true },
	mainDisplay: { logical: { width: 1512, height: 982 }, pixels: { width: 3024, height: 1964 } },
};

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("#given a helper process without Accessibility #when the self-check report is built #then it carries what the doctor needs", () => {
	it("reports the grant state, the process that answered, native capture, approval and toolset", () => {
		vi.stubEnv("APPLE_CUA_ALLOWED_BUNDLE_IDS", "com.apple.TextEdit, com.apple.finder");
		vi.stubEnv("APPLE_CUA_TOOLSET", "lean");

		const report = selfCheckReport({
			probeHost: () => HOST_WITHOUT_ACCESSIBILITY,
			stop: { status: () => ({ stopped: false }) },
			nativeCapture: () => ({ available: false, error: "libsckit.dylib not found" }),
		});

		expect(report).toMatchObject({
			permissions: { accessibility: false, screenRecording: true },
			process: { node: process.version, arch: process.arch, execPath: process.execPath, pid: process.pid },
			nativeCapture: { available: false, error: "libsckit.dylib not found" },
			approval: { allowedBundleIds: ["com.apple.TextEdit", "com.apple.finder"] },
			server: { toolset: "lean" },
			stop: { stopped: false },
		});
		expect(report["advice"]).toEqual(
			expect.arrayContaining([expect.stringContaining("Accessibility is not granted")]),
		);
		expect(JSON.parse(JSON.stringify(report))).toEqual(report);
	});
});

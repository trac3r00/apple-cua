import type { HostCapabilities } from "@apple-cua/core";
import type { AutomationStatus } from "@apple-cua/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePermissionRequests, requestPermissions, selfCheckReport } from "./self-check.js";

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
			automation: (bundleId) => (bundleId === "com.apple.finder" ? "granted" : "not-running"),
		});

		expect(report).toMatchObject({
			permissions: { accessibility: false, screenRecording: true },
			process: { node: process.version, arch: process.arch, execPath: process.execPath, pid: process.pid },
			nativeCapture: { available: false, error: "libsckit.dylib not found" },
			automation: { "com.apple.systemevents": "not-running", "com.apple.finder": "granted" },
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

describe("#given permission requests #when the helper asks for them #then it reports what macOS answered", () => {
	it("parses the kinds and rejects an unknown one", () => {
		expect(parsePermissionRequests("accessibility, screen-recording,automation:com.apple.finder")).toEqual([
			{ kind: "accessibility" },
			{ kind: "screen-recording" },
			{ kind: "automation", bundleId: "com.apple.finder", ask: true },
		]);
		expect(parsePermissionRequests("automation-status:com.apple.systemevents")).toEqual([
			{ kind: "automation", bundleId: "com.apple.systemevents", ask: false },
		]);
		expect(() => parsePermissionRequests("camera")).toThrow("unknown permission request");
		expect(() => parsePermissionRequests("automation:")).toThrow("unknown permission request");
	});

	it("only reads an undecided app when asked for its status, so polling never raises the dialog", () => {
		const asked: string[] = [];
		const report = requestPermissions(parsePermissionRequests("automation-status:com.apple.finder"), {
			requestAccessibility: () => false,
			requestScreenRecording: () => false,
			automation: (bundleId, ask) => {
				asked.push(`${ask ? "ask" : "read"} ${bundleId}`);
				return "not-determined";
			},
			launchSystemEvents: () => {},
			pause: () => {},
		});

		expect(report).toEqual({ automation: { "com.apple.finder": "not-determined" } });
		expect(asked).toEqual(["read com.apple.finder"]);
	});

	it("starts System Events before asking it, asks only an undecided app, and leaves a closed browser alone", () => {
		const calls: string[] = [];
		let systemEventsRunning = false;
		const answers: Record<string, AutomationStatus> = {
			"com.apple.finder": "denied",
			"com.apple.Safari": "not-running",
		};
		const report = requestPermissions(
			parsePermissionRequests(
				"accessibility,screen-recording,automation:com.apple.systemevents,automation:com.apple.finder,automation:com.apple.Safari",
			),
			{
				requestAccessibility: () => {
					calls.push("ask accessibility");
					return false;
				},
				requestScreenRecording: () => {
					calls.push("ask screen recording");
					return true;
				},
				automation: (bundleId, ask) => {
					calls.push(`${ask ? "ask" : "read"} ${bundleId}`);
					if (bundleId === "com.apple.systemevents") {
						return !systemEventsRunning ? "not-running" : ask ? "granted" : "not-determined";
					}
					return answers[bundleId] ?? "unknown";
				},
				launchSystemEvents: () => {
					calls.push("launch System Events");
					systemEventsRunning = true;
				},
				pause: () => {},
			},
		);

		expect(report).toEqual({
			accessibility: false,
			screenRecording: true,
			automation: {
				"com.apple.systemevents": "granted",
				"com.apple.finder": "denied",
				"com.apple.Safari": "not-running",
			},
		});
		expect(calls).toEqual([
			"ask accessibility",
			"ask screen recording",
			"read com.apple.systemevents",
			"launch System Events",
			"read com.apple.systemevents",
			"ask com.apple.systemevents",
			"read com.apple.finder",
			"read com.apple.Safari",
		]);
	});
});

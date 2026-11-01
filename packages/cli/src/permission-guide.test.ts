import { describe, expect, it } from "bun:test";
import type { AutomationStatus } from "@opencua/core";
import { PRIVACY_PANES } from "./doctor.js";
import { type GrantDependencies, type HelperPermissions, grantPermissions } from "./permission-guide.js";

interface FakeMac {
	state: {
		accessibility: boolean;
		screenRecording: boolean;
		inputMonitoring?: boolean;
		automation: Record<string, AutomationStatus>;
	};
	/** What the person does when a dialog or pane shows up for a kind. */
	readonly onRequest: Record<string, () => void>;
	/** Whether the person switches it on while the guide waits, per wait. */
	readonly switchesOn: boolean[];
}

function fake(mac: FakeMac) {
	const calls: string[] = [];
	const printed: string[] = [];
	const read = (): HelperPermissions => ({ ...mac.state, automation: { ...mac.state.automation } });
	const deps: GrantDependencies = {
		read,
		request: (kinds) => {
			calls.push(`request ${kinds.join(",")}`);
			for (const kind of kinds) {
				mac.onRequest[kind]?.();
			}
			const automation = Object.fromEntries(
				kinds
					.filter((kind) => kind.startsWith("automation"))
					.map((kind) => {
						const bundleId = kind.slice(kind.indexOf(":") + 1);
						return [bundleId, mac.state.automation[bundleId] ?? "not-running"];
					}),
			);
			return { accessibility: mac.state.accessibility, screenRecording: mac.state.screenRecording, automation };
		},
		openUrl: async (url) => {
			calls.push(`open ${url}`);
			return true;
		},
		waitFor: async (granted) => {
			calls.push("wait");
			if (mac.switchesOn.shift() === true) {
				mac.onRequest["switch-on"]?.();
			}
			return granted();
		},
		print: (text) => {
			printed.push(text);
		},
	};
	return { deps, calls, printed: () => printed.join("\n") };
}

describe("#given a fresh helper with nothing granted #when a person runs the guide #then each macOS dialog is shown and the guide waits for the switch", () => {
	it("asks Accessibility, then Screen Recording, then each Automation target, and reports what is granted", async () => {
		let pending: "accessibility" | "screenRecording" | undefined;
		const mac: FakeMac = {
			state: {
				accessibility: false,
				screenRecording: false,
				automation: { "com.apple.systemevents": "not-determined", "com.apple.finder": "denied" },
			},
			onRequest: {
				accessibility: () => {
					pending = "accessibility";
				},
				"screen-recording": () => {
					pending = "screenRecording";
				},
				"automation:com.apple.systemevents": () => {
					mac.state.automation["com.apple.systemevents"] = "granted";
				},
				"switch-on": () => {
					if (pending !== undefined) {
						mac.state[pending] = true;
						pending = undefined;
					} else {
						mac.state.automation["com.apple.finder"] = "granted";
					}
				},
			},
			switchesOn: [true, true, true],
		};
		const { deps, calls, printed } = fake(mac);

		const outcome = await grantPermissions(
			{ mode: "terminal", openPanes: true, extraAutomationTargets: ["com.apple.Safari"] },
			deps,
		);

		expect(calls).toEqual([
			"request accessibility",
			`open ${PRIVACY_PANES.accessibility}`,
			"wait",
			"request screen-recording",
			`open ${PRIVACY_PANES.screenRecording}`,
			"wait",
			"request automation:com.apple.systemevents",
			"request automation:com.apple.finder",
			`open ${PRIVACY_PANES.automation}`,
			"wait",
			"request automation-status:com.apple.finder",
			"request automation:com.apple.safari",
		]);
		expect(outcome).toEqual({
			granted: ["Accessibility", "Screen Recording", "Automation of System Events", "Automation of Finder"],
			missing: [],
			notAsked: ["Automation of Safari"],
		});
		expect(printed()).toContain("Restart your MCP clients");
	});

	it("records a skipped grant as missing and points at the command that finishes it", async () => {
		const mac: FakeMac = {
			state: { accessibility: true, screenRecording: false, automation: {} },
			onRequest: {},
			switchesOn: [false],
		};
		const { deps, printed } = fake(mac);

		const outcome = await grantPermissions({ mode: "terminal", openPanes: false, extraAutomationTargets: [] }, deps);

		expect(outcome.missing).toEqual(["Screen Recording"]);
		expect(printed()).toContain(`open "${PRIVACY_PANES.screenRecording}"`);
		expect(printed()).toContain("opencua permissions grant");
		expect(printed()).toContain("tccutil reset ScreenCapture dev.applecua.mcp");
	});
});

describe("#given an Automation dialog closed without an answer #when the guide asks #then it neither waits nor asks again", () => {
	it("reports the app as missing and points at the command that asks again", async () => {
		const mac: FakeMac = {
			state: {
				accessibility: true,
				screenRecording: true,
				automation: { "com.apple.systemevents": "not-determined" },
			},
			onRequest: {},
			switchesOn: [],
		};
		const { deps, calls, printed } = fake(mac);

		const outcome = await grantPermissions({ mode: "terminal", openPanes: true, extraAutomationTargets: [] }, deps);

		expect(calls).toEqual(["request automation:com.apple.systemevents"]);
		expect(outcome.missing).toEqual(["Automation of System Events"]);
		expect(printed()).toContain("macOS recorded no answer");
	});
});

describe("#given nobody who can switch anything on #when the guide reports #then it shows no dialog and lists what is missing", () => {
	it("never asks macOS and reports every missing grant", async () => {
		const mac: FakeMac = {
			state: {
				accessibility: false,
				screenRecording: true,
				automation: { "com.apple.systemevents": "not-determined" },
			},
			onRequest: {},
			switchesOn: [],
		};
		const { deps, calls } = fake(mac);

		const outcome = await grantPermissions({ mode: "report", openPanes: true, extraAutomationTargets: [] }, deps);

		expect(calls).toEqual([]);
		expect(outcome.missing).toEqual(["Accessibility", "Automation of System Events"]);
	});
});

describe("#given an agent running the guide with no terminal #when a person is at the Mac #then it watches each switch and moves on", () => {
	it("shows each dialog, opens each pane and watches, and names a switch left off as not switched on in time", async () => {
		let pending: "accessibility" | "screenRecording" | undefined;
		const mac: FakeMac = {
			state: { accessibility: false, screenRecording: false, automation: {} },
			onRequest: {
				accessibility: () => {
					pending = "accessibility";
				},
				"screen-recording": () => {
					pending = "screenRecording";
				},
				"switch-on": () => {
					if (pending !== undefined) {
						mac.state[pending] = true;
					}
				},
			},
			switchesOn: [true, false],
		};
		const { deps, calls, printed } = fake(mac);

		const outcome = await grantPermissions({ mode: "watch", openPanes: true, extraAutomationTargets: [] }, deps);

		expect(calls).toEqual([
			"request accessibility",
			`open ${PRIVACY_PANES.accessibility}`,
			"wait",
			"request screen-recording",
			`open ${PRIVACY_PANES.screenRecording}`,
			"wait",
		]);
		expect(outcome.granted).toEqual(["Accessibility"]);
		expect(outcome.missing).toEqual(["Screen Recording"]);
		expect(printed()).toContain("moves on by itself");
		expect(printed()).toContain("not switched on in time");
		expect(printed()).not.toContain("type s");
	});
});

describe("#given the cua-history watcher is installed #when a person runs the guide #then Input Monitoring is walked through too", () => {
	it("asks Input Monitoring and opens its pane only when the option is on", async () => {
		const mac: FakeMac = {
			state: { accessibility: true, screenRecording: true, inputMonitoring: false, automation: {} },
			onRequest: {
				"switch-on": () => {
					mac.state.inputMonitoring = true;
				},
			},
			switchesOn: [true],
		};
		const withHistory = fake(mac);
		const outcome = await grantPermissions(
			{ mode: "terminal", openPanes: true, extraAutomationTargets: [], inputMonitoring: true },
			withHistory.deps,
		);
		expect(outcome).toEqual({ granted: ["Input Monitoring"], missing: [], notAsked: [] });
		expect(withHistory.calls).toEqual(["request input-monitoring", `open ${PRIVACY_PANES.inputMonitoring}`, "wait"]);

		const without = fake({
			state: { accessibility: true, screenRecording: true, inputMonitoring: false, automation: {} },
			onRequest: {},
			switchesOn: [],
		});
		const skipped = await grantPermissions(
			{ mode: "terminal", openPanes: true, extraAutomationTargets: [] },
			without.deps,
		);
		expect(skipped).toEqual({ granted: [], missing: [], notAsked: [] });
		expect(without.calls).toEqual([]);
	});
});

describe("#given a permission changes while the guide is open #when the next pane is considered #then it uses a fresh helper report", () => {
	it("does not prompt for Screen Recording after a fresh report says it was granted during Accessibility", async () => {
		const mac: FakeMac = {
			state: { accessibility: false, screenRecording: false, inputMonitoring: false, automation: {} },
			onRequest: {
				accessibility: () => {
					mac.state.accessibility = true;
					mac.state.screenRecording = true;
				},
			},
			switchesOn: [true],
		};
		const { deps, calls } = fake(mac);

		const outcome = await grantPermissions({ mode: "terminal", openPanes: true, extraAutomationTargets: [] }, deps);

		expect(calls).toEqual(["request accessibility", `open ${PRIVACY_PANES.accessibility}`, "wait"]);
		expect(outcome).toEqual({ granted: ["Accessibility"], missing: [], notAsked: [] });
	});

	it("reports an unreadable final check separately from a permission still reported off", async () => {
		const mac = fake({
			state: { accessibility: false, screenRecording: true, automation: {} },
			onRequest: {},
			switchesOn: [],
		});
		let reads = 0;
		const deps: GrantDependencies = {
			...mac.deps,
			read: () => {
				reads += 1;
				return reads === 3 ? undefined : mac.deps.read();
			},
			waitFor: async () => false,
		};

		const outcome = await grantPermissions({ mode: "terminal", openPanes: false, extraAutomationTargets: [] }, deps);

		expect(outcome.missing).toEqual(["Accessibility"]);
		expect(mac.printed()).toContain(
			"Could not verify Accessibility: the helper did not return a fresh permission report.",
		);
		expect(mac.printed()).not.toContain("latest check from");
	});

	it("uses the final fresh report when a grant lands just after the wait expires", async () => {
		const state = { accessibility: false, screenRecording: true, automation: {} };
		const mac = fake({
			state,
			onRequest: {},
			switchesOn: [],
		});
		const deps: GrantDependencies = {
			...mac.deps,
			waitFor: async () => {
				state.accessibility = true;
				mac.deps.read();
				return false;
			},
		};
		const outcome = await grantPermissions({ mode: "terminal", openPanes: false, extraAutomationTargets: [] }, deps);

		expect(outcome).toEqual({ granted: ["Accessibility"], missing: [], notAsked: [] });
	});
});

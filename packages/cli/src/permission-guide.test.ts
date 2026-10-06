import type { AutomationStatus } from "@apple-cua/core";
import { describe, expect, it } from "vitest";
import { PRIVACY_PANES } from "./doctor.js";
import { type GrantDependencies, type HelperPermissions, grantPermissions } from "./permission-guide.js";

interface FakeMac {
	state: { accessibility: boolean; screenRecording: boolean; automation: Record<string, AutomationStatus> };
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
			{ interactive: true, openPanes: true, extraAutomationTargets: ["com.apple.Safari"] },
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

		const outcome = await grantPermissions({ interactive: true, openPanes: false, extraAutomationTargets: [] }, deps);

		expect(outcome.missing).toEqual(["Screen Recording"]);
		expect(printed()).toContain(`open "${PRIVACY_PANES.screenRecording}"`);
		expect(printed()).toContain("apple-cua permissions grant");
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

		const outcome = await grantPermissions({ interactive: true, openPanes: true, extraAutomationTargets: [] }, deps);

		expect(calls).toEqual(["request automation:com.apple.systemevents"]);
		expect(outcome.missing).toEqual(["Automation of System Events"]);
		expect(printed()).toContain("macOS recorded no answer");
	});
});

describe("#given nobody at the terminal #when the guide runs #then it shows no dialog and lists what is missing", () => {
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

		const outcome = await grantPermissions({ interactive: false, openPanes: true, extraAutomationTargets: [] }, deps);

		expect(calls).toEqual([]);
		expect(outcome.missing).toEqual(["Accessibility", "Automation of System Events"]);
	});
});

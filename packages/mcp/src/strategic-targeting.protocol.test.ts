import type { AppOpenLauncher } from "@apple-cua/core";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, jsonPayload } from "./protocol-client-harness.js";
import { FakeGuardedComputer } from "./protocol-test-harness.js";

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	if (closeHarness !== undefined) {
		await closeHarness();
		closeHarness = undefined;
	}
});

function recordArray(payload: Record<string, unknown>, key: string): Record<string, unknown>[] {
	const value = payload[key];
	if (!Array.isArray(value)) {
		throw new Error(`payload field ${key} must be an array`);
	}
	return value.map((entry) => {
		if (typeof entry !== "object" || entry === null) {
			throw new Error(`payload field ${key} entries must be objects`);
		}
		return Object.fromEntries(Object.entries(entry));
	});
}

function recordingLauncher(): { readonly launcher: AppOpenLauncher; readonly targets: string[] } {
	const targets: string[] = [];
	return {
		targets,
		launcher: {
			async launch(target: string): Promise<void> {
				targets.push(target);
			},
		},
	};
}

describe("#given an app whose tree holds the described control #when find_elements asks by description #then the answer carries the id, a usable token, and no pixels", () => {
	it("resolves the label to an element index and authorizes the follow-up click", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;

		const result = await harness.client.callTool({
			name: "find_elements",
			arguments: { app: "Finder", query: { label: "Open" } },
		});
		const payload = jsonPayload(result);
		const matches = recordArray(payload, "matches");

		expect(payload["found"]).toBe(true);
		expect(matches[0]).toMatchObject({ element_index: "9", role: "AXButton", label: "Open" });
		expect(typeof payload["observation_token"]).toBe("string");
		expect(harness.computer.stateOptions.at(-1)).toMatchObject({
			requireWindow: true,
			includeScreenshot: false,
		});

		const click = await harness.client.callTool({
			name: "click",
			arguments: {
				app: "Finder",
				observation_token: payload["observation_token"],
				element_index: "9",
			},
		});
		expect(click.isError).toBeFalsy();
		expect(harness.computer.effects).toContainEqual({ kind: "performAction", pid: 1234, id: 9, action: "AXPress" });
	});
});

describe("#given nothing carries the described label #when find_elements misses #then it answers honestly with near misses", () => {
	it("answers found false with the closest candidates and a fresh token", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;

		const result = await harness.client.callTool({
			name: "find_elements",
			arguments: { app: "Finder", query: { label: "Open file" } },
		});
		const payload = jsonPayload(result);
		const misses = recordArray(payload, "nearMisses");

		expect(result.isError).toBeFalsy();
		expect(payload["found"]).toBe(false);
		expect(recordArray(payload, "matches")).toEqual([]);
		expect(misses[0]).toMatchObject({ element_index: "9", label: "Open" });
		expect(typeof payload["observation_token"]).toBe("string");
	});

	it("passes include_screenshot and max_elements through when the caller widens the observation", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;

		await harness.client.callTool({
			name: "find_elements",
			arguments: { app: "Finder", query: { label: "Open" }, include_screenshot: true, max_elements: 900 },
		});

		expect(harness.computer.stateOptions.at(-1)).toMatchObject({ includeScreenshot: true, maxElements: 900 });
	});
});

describe("#given a described control #when click_target acts #then it presses the resolved element by the accessibility route", () => {
	it("dispatches AXPress on the resolved id and answers with the target and a fresh token", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;

		const result = await harness.client.callTool({
			name: "click_target",
			arguments: { app: "Finder", query: { label: "Open" } },
		});
		const payload = jsonPayload(result);
		const target = payload["target"] as Record<string, unknown> | undefined;

		expect(result.isError).toBeFalsy();
		expect(payload["found"]).toBe(true);
		expect(payload["actionDispatched"]).toBe(true);
		expect(target).toMatchObject({ element_index: "9", role: "AXButton", label: "Open" });
		expect(payload["attempts"]).toBe(1);
		expect(harness.computer.effects).toContainEqual({ kind: "performAction", pid: 1234, id: 9, action: "AXPress" });
		expect(harness.computer.stateOptions.at(-1)).toMatchObject({ includeScreenshot: false });
	});
});

describe("#given a control that only appears on a later observation #when click_target waits #then it acts after the wait instead of failing fast", () => {
	it("re-observes until the element exists and then dispatches", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		harness.computer.hiddenElementIds.add(9);
		harness.computer.onStateCall = (call) => {
			if (call >= 2) {
				harness.computer.hiddenElementIds.delete(9);
			}
		};

		const result = await harness.client.callTool({
			name: "click_target",
			arguments: { app: "Finder", query: { label: "Open" }, timeout_ms: 2_000 },
		});
		const payload = jsonPayload(result);

		expect(result.isError).toBeFalsy();
		expect(payload["found"]).toBe(true);
		expect(payload["attempts"]).toBeGreaterThanOrEqual(2);
		expect(harness.computer.effects).toContainEqual({ kind: "performAction", pid: 1234, id: 9, action: "AXPress" });
	});
});

describe("#given a label no element carries #when click_target runs out of patience #then it is inert, honest, and still hands back the fresh tree token", () => {
	it("answers found false without dispatching anything and lists what it did see", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;

		const result = await harness.client.callTool({
			name: "click_target",
			arguments: { app: "Finder", query: { label: "Open file" }, timeout_ms: 0 },
		});
		const payload = jsonPayload(result);
		const misses = recordArray(payload, "nearMisses");

		expect(result.isError).toBeFalsy();
		expect(payload["found"]).toBe(false);
		expect(payload["actionDispatched"]).toBe(false);
		expect(harness.computer.effects).toEqual([]);
		expect(misses[0]).toMatchObject({ element_index: "9", label: "Open" });
		expect(typeof payload["observation_token"]).toBe("string");
	});
});

describe("#given a target with no accessibility press #when click_target acts #then it clicks the element centre with the pointer", () => {
	it("computes the screen point from the observed frame and reports the synthetic route", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		harness.computer.syntheticRowCount = 1;

		const result = await harness.client.callTool({
			name: "click_target",
			arguments: { app: "Finder", query: { label_contains: "result row 0" } },
		});
		const payload = jsonPayload(result);

		expect(payload["found"]).toBe(true);
		expect(payload["route"]).toBe("synthetic_events");
		expect(harness.computer.effects).toContainEqual({ kind: "click", point: { x: 540, y: 168 } });
		expect(harness.computer.effects).not.toContainEqual({
			kind: "performAction",
			pid: 1234,
			id: 100,
			action: "AXPress",
		});
	});
});

describe("#given hover_first #when click_target acts #then the pointer moves to the target before the press", () => {
	it("hovers the element centre and then presses it", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;

		const result = await harness.client.callTool({
			name: "click_target",
			arguments: { app: "Finder", query: { label: "Open" }, hover_first: true },
		});

		expect(result.isError).toBeFalsy();
		expect(harness.computer.effects).toEqual([
			{ kind: "move", point: { x: 350, y: 230 } },
			{ kind: "performAction", pid: 1234, id: 9, action: "AXPress" },
		]);
	});
});

describe("#given several elements that match #when index selects the second #then the answer names the alternatives it skipped", () => {
	it("dispatches on the indexed match and lists the other matches", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;

		const result = await harness.client.callTool({
			name: "click_target",
			arguments: { app: "Finder", query: { role: "textfield" }, index: 1 },
		});
		const payload = jsonPayload(result);
		const target = payload["target"] as Record<string, unknown>;
		const alternatives = recordArray(payload, "alternatives");

		expect(target).toMatchObject({ element_index: "21", label: "Status" });
		expect(alternatives[0]).toMatchObject({ element_index: "20", label: "Note" });
	});
});

describe("#given an expect block #when click_target acts #then the outcome is verified in the same answer", () => {
	it("reports the verification alongside the target", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;

		const result = await harness.client.callTool({
			name: "click_target",
			arguments: {
				app: "Finder",
				query: { label: "Open" },
				expect: { checks: [{ element_index: "9", label: "Open" }] },
			},
		});
		const payload = jsonPayload(result);
		const verification = payload["verification"] as Record<string, unknown>;

		expect(verification["verified"]).toBe(true);
		expect(payload["found"]).toBe(true);
	});

	it("keeps the answer compact: the verified outcome is a diff, not the whole tree", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;

		await harness.client.callTool({
			name: "click_target",
			arguments: {
				app: "Finder",
				query: { label: "Open" },
				expect: { checks: [{ element_index: "9", exists: true }] },
			},
		});
		expect(harness.computer.stateOptions.at(-1)).toMatchObject({ diffOnly: true, includeScreenshot: false });

		const widened = await createHarness();
		closeHarness = widened.close;
		await widened.client.callTool({
			name: "click_target",
			arguments: {
				app: "Finder",
				query: { label: "Open" },
				expect: { checks: [{ element_index: "9", exists: true }] },
				full_state: true,
			},
		});
		expect(widened.computer.stateOptions.at(-1)).not.toMatchObject({ diffOnly: true });
	});
});

describe("#given a running app #when open_app runs #then it activates that app and answers without waiting", () => {
	it("activates by bundle id and reports the app it found", async () => {
		const harness = await createHarness(new FakeGuardedComputer(), undefined, recordingLauncher().launcher);
		closeHarness = harness.close;

		const result = await harness.client.callTool({ name: "open_app", arguments: { name: "finder" } });
		const payload = jsonPayload(result);

		expect(result.isError).toBeFalsy();
		expect(payload).toMatchObject({
			launched: false,
			activated: true,
			pid: 1234,
			bundleId: "com.apple.finder",
			name: "Finder",
		});
	});
});

describe("#given an app that never becomes observable #when open_app waits #then it answers an honest bounded error", () => {
	it("reports the timeout instead of claiming success", async () => {
		const { launcher, targets } = recordingLauncher();
		const harness = await createHarness(new FakeGuardedComputer(), undefined, launcher);
		closeHarness = harness.close;

		const result = await harness.client.callTool({
			name: "open_app",
			arguments: { name: "Ghost App", timeout_ms: 60 },
		});

		expect(result.isError).toBe(true);
		expect(JSON.stringify(result.content)).toContain("Ghost App");
		expect(targets).toEqual(["Ghost App"]);
	});
});

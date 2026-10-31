import { afterEach, describe, expect, it } from "bun:test";
import { vi } from "@apple-cua/test-support";
import { createHarness, jsonPayload, observe } from "./protocol-client-harness.js";

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	await closeHarness?.();
	closeHarness = undefined;
});

describe("#given an observed control advertising AXShowMenu #when right-clicked #then its menu action runs without AXPress", () => {
	it.each(["click", "run_steps", "click_target"])("opens through %s", async (name) => {
		const harness = await createHarness();
		closeHarness = harness.close;
		harness.computer.elementActions.set(9, ["AXPress", "AXShowMenu"]);
		const token = await observe(harness);
		const rightClick = vi.spyOn(harness.computer, "rightClick");
		const result = await harness.client.callTool({
			name,
			arguments:
				name === "click_target"
					? { app: "Finder", query: { label: "Open" }, mouse_button: "right", press: "accessibility" }
					: name === "run_steps"
						? {
								app: "Finder",
								observation_token: token,
								steps: [{ type: "click", target: { label: "Open" }, mouse_button: "right" }],
							}
						: { app: "Finder", observation_token: token, element_index: "9", mouse_button: "right" },
		});

		expect(result.isError).not.toBe(true);
		expect(harness.computer.effects).toContainEqual({
			kind: "performAction",
			pid: 1234,
			id: 9,
			action: "AXShowMenu",
		});
		expect(
			harness.computer.effects.some((effect) => effect.kind === "performAction" && effect.action === "AXPress"),
		).toBe(false);
		expect(rightClick).not.toHaveBeenCalled();
	});

	it("keeps a modified right-click on the pointer route", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		harness.computer.elementActions.set(9, ["AXShowMenu"]);
		harness.computer.elementFrames.set(9, { x: 100, y: 200, width: 40, height: 20 });
		const token = await observe(harness);
		const rightClick = vi.spyOn(harness.computer, "rightClick");
		await harness.client.callTool({
			name: "click",
			arguments: {
				app: "Finder",
				observation_token: token,
				element_index: "9",
				mouse_button: "right",
				modifiers: ["shift"],
			},
		});
		expect(rightClick).toHaveBeenCalledOnce();
		expect(harness.computer.effects.some((effect) => effect.kind === "performAction")).toBe(false);
	});

	it.each([
		{ actions: ["AXPress"], press: "accessibility" },
		{ actions: ["AXPress", "AXShowMenu"], press: "pointer" },
	])("uses pointer input rather than AXPress for %o", async ({ actions, press }) => {
		const harness = await createHarness();
		closeHarness = harness.close;
		harness.computer.elementActions.set(9, actions);
		const rightClick = vi.spyOn(harness.computer, "rightClick");
		const result = await harness.client.callTool({
			name: "click_target",
			arguments: { app: "Finder", query: { label: "Open" }, mouse_button: "right", press },
		});
		expect(result.isError).not.toBe(true);
		expect(rightClick).toHaveBeenCalledOnce();
		expect(harness.computer.effects.some((effect) => effect.kind === "performAction")).toBe(false);
	});

	it("resolves a menu created by the preceding script action under a fresh observation", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		harness.computer.elementActions.set(9, ["AXShowMenu"]);
		const perform = harness.computer.performAction.bind(harness.computer);
		vi.spyOn(harness.computer, "performAction").mockImplementation(async (pid, id, action) => {
			await perform(pid, id, action);
			if (action === "AXShowMenu") {
				harness.computer.extraElements.push({
					id: 30,
					role: "AXMenuItem",
					label: "Choose",
					value: null,
					frame: { x: 510, y: 410, width: 100, height: 20 },
					actions: ["AXPress"],
					children: [],
				});
			}
		});
		const result = await harness.client.callTool({
			name: "run_script",
			arguments: {
				code: `
					const finder = apple.app("Finder");
					await finder.click({ label: "Open" }, { mouseButton: "right" });
					await finder.click({ role: "menuitem", label: "Choose" });
					return "chosen";
				`,
			},
		});
		expect(jsonPayload(result)).toMatchObject({ ok: true, value: "chosen" });
		expect(harness.computer.effects).toEqual([
			{ kind: "performAction", pid: 1234, id: 9, action: "AXShowMenu" },
			{ kind: "performAction", pid: 1234, id: 30, action: "AXPress" },
		]);
	});
});

describe("#given a dropdown menu outside the window viewport #when observed by label #then its item is actionable only under its fresh token", () => {
	it("discovers and presses the menu item without requiring screenshot coordinates", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;
		harness.computer.extraElements.push({
			id: 30,
			role: "AXMenuItem",
			label: "Choose",
			value: null,
			frame: { x: 510, y: 410, width: 100, height: 20 },
			actions: ["AXPress"],
			children: [],
		});
		const found = await harness.client.callTool({
			name: "find_elements",
			arguments: { app: "Finder", query: { role: "menuitem", label: "Choose" } },
		});
		const payload = jsonPayload(found);
		expect(payload["found"]).toBe(true);
		const result = await harness.client.callTool({
			name: "click",
			arguments: { app: "Finder", observation_token: payload["observation_token"], element_index: "30" },
		});
		expect(result.isError).not.toBe(true);
		expect(harness.computer.effects).toContainEqual({ kind: "performAction", pid: 1234, id: 30, action: "AXPress" });
		const stale = await harness.client.callTool({
			name: "click",
			arguments: { app: "Finder", observation_token: payload["observation_token"], element_index: "30" },
		});
		expect(JSON.stringify(stale)).toContain("refused");
		expect(harness.computer.effects.filter((effect) => effect.kind === "performAction")).toHaveLength(1);
	});
});

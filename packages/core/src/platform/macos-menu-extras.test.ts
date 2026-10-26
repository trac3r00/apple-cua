import { describe, expect, it, vi } from "vitest";
import type { AXTreeElement } from "../accessibility/types.js";
import { createNativeMenuExtrasSource } from "./macos-menu-extras.js";

const PID = 637;

function element(id: number, role: string, label: string | null, actions: string[]): AXTreeElement {
	return {
		id,
		role,
		label,
		value: null,
		frame: { x: id, y: 0, width: 24, height: 24 },
		actions,
		children: [],
	};
}

function setup(
	elements = [
		element(2, "AXMenuBarItem", "Wi-Fi", ["AXPress"]),
		element(3, "AXStatusBarItem", "Battery", ["AXPress"]),
		element(4, "AXMenuBarItem", "Clock", ["AXPress"]),
		element(5, "AXStaticText", "ignored", []),
	],
) {
	let live = elements;
	let key: string | undefined = "1:controlcenter";
	let pid: number | undefined = PID;
	let enabled = true;
	const perform = vi.fn();
	const source = createNativeMenuExtrasSource({
		findControlCenter: () => pid,
		extract: () => ({ elements: live, truncated: false }),
		observationKey: () => key,
		enabled: () => enabled,
		perform,
	});
	return {
		source,
		perform,
		setElements(value: AXTreeElement[]) {
			live = value;
		},
		setKey(value: string | undefined) {
			key = value;
		},
		setPid(value: number | undefined) {
			pid = value;
		},
		setEnabled(value: boolean) {
			enabled = value;
		},
	};
}

describe("#given Control Center accessibility #when observing menu extras #then actionable bar items retain their AX identity", () => {
	it("lists generic extra roles with labels and frames", async () => {
		const { source } = setup();
		const snapshot = await source.read();
		expect(snapshot.items.map(({ id, role, label, frame }) => ({ id, role, label, frame }))).toEqual([
			{ id: 2, role: "AXMenuBarItem", label: "Wi-Fi", frame: { x: 2, y: 0, width: 24, height: 24 } },
			{ id: 3, role: "AXStatusBarItem", label: "Battery", frame: { x: 3, y: 0, width: 24, height: 24 } },
			{ id: 4, role: "AXMenuBarItem", label: "Clock", frame: { x: 4, y: 0, width: 24, height: 24 } },
		]);
	});

	it("presses an unchanged observed item", async () => {
		const { source, perform } = setup();
		const snapshot = await source.read();
		await source.act(snapshot, 2);
		expect(perform).toHaveBeenCalledWith(PID, 2, "AXPress");
	});

	it("refuses stale snapshots and changed observations", async () => {
		const stale = setup();
		const old = await stale.source.read();
		await stale.source.read();
		await expect(stale.source.act(old, 2)).rejects.toThrow("stale");

		const changed = setup();
		const snapshot = await changed.source.read();
		changed.setKey("2:controlcenter");
		await expect(changed.source.act(snapshot, 2)).rejects.toThrow("observation changed");
		expect(changed.perform).not.toHaveBeenCalled();
	});

	it("#given an observed menu extra #when it is disabled #then no press is dispatched", async () => {
		const access = setup();
		const snapshot = await access.source.read();
		access.setEnabled(false);
		await expect(access.source.act(snapshot, 2)).rejects.toThrow("disabled");
		expect(access.perform).not.toHaveBeenCalled();
	});

	it("refuses a replaced process and a changed control identity", async () => {
		const replaced = setup();
		const snapshot = await replaced.source.read();
		replaced.setPid(PID + 1);
		await expect(replaced.source.act(snapshot, 2)).rejects.toThrow("process changed");

		const identity = setup();
		const observed = await identity.source.read();
		identity.setElements([element(2, "AXMenuBarItem", "Bluetooth", ["AXPress"])]);
		await expect(identity.source.act(observed, 2)).rejects.toThrow("no longer matches");
	});
});

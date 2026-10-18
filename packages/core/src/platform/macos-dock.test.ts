import { describe, expect, it, vi } from "vitest";
import type { AXTreeElement } from "../accessibility/types.js";
import { createNativeDockSource } from "./macos-dock.js";

const DOCK_PID = 4242;

function element(
	id: number,
	role: string,
	label: string | null,
	actions: string[],
	value: string | null = null,
): AXTreeElement {
	return { id, role, label, value, actions, children: [], frame: { x: 0, y: 0, width: 0, height: 0 } };
}

function setup(
	elements: AXTreeElement[] = [
		element(3, "AXDockItem", "Finder", ["AXPress", "AXShowMenu"]),
		element(4, "AXMenuItem", "Options", ["AXPress"]),
		element(5, "AXButton", "Unrelated button", ["AXPress"]),
	],
) {
	let liveElements = elements;
	let key: string | undefined = "1:dock";
	let pid: number | undefined = DOCK_PID;
	let enabled = true;
	const perform = vi.fn();
	const source = createNativeDockSource({
		findDock: () => pid,
		extract: () => ({ elements: liveElements, truncated: false }),
		observationKey: () => key,
		enabled: () => enabled,
		perform,
	});
	return {
		source,
		perform,
		setElements(value: AXTreeElement[]) {
			liveElements = value;
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

describe("createNativeDockSource", () => {
	it("filters discovery to Dock and menu items and preserves native ids", async () => {
		const { source } = setup();
		const snapshot = await source.read();
		expect(snapshot).toMatchObject({ pid: DOCK_PID, observationKey: "1:dock", truncated: false });
		expect(snapshot.elements.map(({ id, role }) => ({ id, role }))).toEqual([
			{ id: 3, role: "AXDockItem" },
			{ id: 4, role: "AXMenuItem" },
		]);
	});

	it("refuses a read when the native observation key is unavailable", async () => {
		const access = setup();
		access.setKey(undefined);
		await expect(access.source.read()).rejects.toThrow("observation key is unavailable");
	});

	it("acts on a currently matching observed item", async () => {
		const { source, perform } = setup();
		const snapshot = await source.read();
		await source.act(snapshot, 3, "AXPress");
		expect(perform).toHaveBeenCalledWith(DOCK_PID, 3, "AXPress");
	});

	it("refuses an older snapshot after another read", async () => {
		const { source, perform } = setup();
		const oldSnapshot = await source.read();
		await source.read();
		await expect(source.act(oldSnapshot, 3, "AXPress")).rejects.toThrow("stale");
		expect(perform).not.toHaveBeenCalled();
	});

	it("refuses changes in generation, current identity, unadvertised actions, and arbitrary roles", async () => {
		const generation = setup();
		const generationSnapshot = await generation.source.read();
		generation.setKey("2:dock");
		await expect(generation.source.act(generationSnapshot, 3, "AXPress")).rejects.toThrow("observation changed");

		const identity = setup();
		const identitySnapshot = await identity.source.read();
		identity.setElements([element(3, "AXDockItem", "Other app", ["AXPress"])]);
		await expect(identity.source.act(identitySnapshot, 3, "AXPress")).rejects.toThrow("no longer matches");

		const disabled = setup([element(3, "AXDockItem", "Finder", ["AXPress"])]);
		const disabledSnapshot = await disabled.source.read();
		await expect(disabled.source.act(disabledSnapshot, 3, "AXShowMenu")).rejects.toThrow("does not advertise");

		const arbitrary = setup([element(3, "AXButton", "Button", ["AXPress"])]);
		const arbitrarySnapshot = await arbitrary.source.read();
		await expect(arbitrary.source.act(arbitrarySnapshot, 3, "AXPress")).rejects.toThrow("absent or ambiguous");
	});

	it("#given an observed Dock tile #when AXEnabled becomes false #then no action is dispatched", async () => {
		const access = setup();
		const snapshot = await access.source.read();
		access.setEnabled(false);
		await expect(access.source.act(snapshot, 3, "AXPress")).rejects.toThrow("disabled");
		expect(access.perform).not.toHaveBeenCalled();
	});

	it("refuses process replacement", async () => {
		const { source, setPid, perform } = setup();
		const snapshot = await source.read();
		setPid(DOCK_PID + 1);
		await expect(source.act(snapshot, 3, "AXPress")).rejects.toThrow("process changed");
		expect(perform).not.toHaveBeenCalled();
	});
});

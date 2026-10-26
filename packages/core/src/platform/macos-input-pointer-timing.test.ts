import { afterEach, describe, expect, it } from "vitest";

const key = "APPLE_CUA_GESTURE_PRIMER_SETTLE_MS";

afterEach(() => {
	delete process.env[key];
});

describe("#given unset primer timing #when reading its getter #then the lowered default is returned", () => {
	it("returns 40 milliseconds", async () => {
		const { gesturePrimerSettleMilliseconds } = await import("./macos-input-pointer.js");
		expect(gesturePrimerSettleMilliseconds()).toBe(40);
	});
});

describe("#given primer timing environment values #when parsing them #then valid integer values are retained", () => {
	it.each([
		["0", 0],
		["abc", 40],
		["-3", 40],
		["  ", 40],
		["40", 40],
	])("parses %j as %i", async (value, expected) => {
		process.env[key] = value;
		const { gesturePrimerSettleMilliseconds } = await import("./macos-input-pointer.js");
		expect(gesturePrimerSettleMilliseconds()).toBe(expected);
	});
});

describe("#given an activation primer #when sleep is injected #then the fixed gap and nonzero settle are awaited", () => {
	it("skips the settle wait when it is zero", async () => {
		process.env[key] = "0";
		const { postActivationPrimer } = await import("./macos-input-pointer.js");
		const events: string[] = [];
		const waits: number[] = [];
		await postActivationPrimer(
			async (kind) => {
				events.push(kind);
			},
			{ id: 1, bounds: { x: 0, y: 0, width: 10, height: 10 } },
			{ x: -1, y: -1 },
			{
				sleep: async (milliseconds) => {
					waits.push(milliseconds);
				},
			},
		);
		expect(events).toEqual(["down", "up"]);
		expect(waits).toEqual([1]);
	});

	it("records the configured settle after the fixed gap", async () => {
		process.env[key] = "40";
		const { postActivationPrimer } = await import("./macos-input-pointer.js");
		const waits: number[] = [];
		await postActivationPrimer(
			async () => undefined,
			{ id: 1, bounds: { x: 0, y: 0, width: 10, height: 10 } },
			{ x: -1, y: -1 },
			{
				sleep: async (milliseconds) => {
					waits.push(milliseconds);
				},
			},
		);
		expect(waits).toEqual([1, 40]);
	});
});

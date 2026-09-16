import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type RunningApplicationLookup,
	findRunningApp,
	getRunningMacOSApps,
	parseRunningApps,
	setRunningApplicationLookupForTesting,
} from "./app-list.js";

const FINDER = {
	name: "Finder",
	bundleId: "com.apple.finder",
	pid: 489,
	isActive: false,
	path: "/System/Library/CoreServices/Finder.app",
} as const;
const TERMINAL = {
	name: "Terminal",
	bundleId: "com.apple.Terminal",
	pid: 422,
	isActive: true,
	path: "/System/Applications/Utilities/Terminal.app",
} as const;

afterEach(() => {
	setRunningApplicationLookupForTesting(undefined);
});

describe("#given mocked AppKit running applications #when enumerating #then JXA-compatible sorted records are returned", () => {
	it("maps the FFI fields to the existing RunningAppInfo shape", async () => {
		const lookup = mockLookup([TERMINAL, FINDER]);
		setRunningApplicationLookupForTesting(lookup);

		const applications = await getRunningMacOSApps();
		const jxaDerived = parseRunningApps(JSON.stringify([TERMINAL, FINDER]));

		expect(applications).toEqual(jxaDerived);
		expect(applications).toEqual([
			{ ...FINDER, isRunning: true },
			{ ...TERMINAL, isRunning: true },
		]);
		expect(lookup.getRunningApplications).toHaveBeenCalledOnce();
	});
});

describe("#given a pid or bundle identifier #when finding one running app #then full enumeration is avoided", () => {
	it("delegates pid lookup directly to NSRunningApplication", async () => {
		const lookup = mockLookup([FINDER]);
		setRunningApplicationLookupForTesting(lookup);

		const application = await findRunningApp(FINDER.pid);

		expect(application).toEqual({ ...FINDER, isRunning: true });
		expect(lookup.findRunningApplication).toHaveBeenCalledWith(FINDER.pid);
		expect(lookup.getRunningApplications).not.toHaveBeenCalled();
	});

	it("returns undefined when the direct bundle lookup has no match", async () => {
		const lookup = mockLookup([]);
		setRunningApplicationLookupForTesting(lookup);

		await expect(findRunningApp("com.example.absent")).resolves.toBeUndefined();
		expect(lookup.getRunningApplications).not.toHaveBeenCalled();
	});
});

function mockLookup(applications: readonly (typeof FINDER | typeof TERMINAL)[]) {
	return {
		getRunningApplications: vi.fn(() => applications),
		findRunningApplication: vi.fn((identifier: Parameters<RunningApplicationLookup["findRunningApplication"]>[0]) =>
			applications.find((application) =>
				typeof identifier === "number"
					? application.pid === identifier
					: application.bundleId === identifier || application.name === identifier,
			),
		),
	} satisfies RunningApplicationLookup;
}

import { describe, expect, it, vi } from "vitest";

import type { AppInfo } from "../accessibility/types.js";
import { resolveAppPid } from "./actions.js";
import type { ComputerInterface } from "./interface.js";

function app(name: string, bundleId: string, pid: number): AppInfo {
	return { name, bundleId, pid, isRunning: true };
}

const APPS: readonly AppInfo[] = [
	app("Safari Technology Preview", "com.apple.SafariTechnologyPreview", 10),
	app("Safari", "com.apple.Safari", 20),
	app("Notes", "com.apple.Notes", 30),
];

interface ResolverComputer {
	readonly computer: Pick<ComputerInterface, "listApps" | "listAppIdentities">;
	readonly listApps: ReturnType<typeof vi.fn<ComputerInterface["listApps"]>>;
	readonly listAppIdentities: ReturnType<typeof vi.fn<() => Promise<AppInfo[]>>>;
}

function resolverComputer(apps: () => AppInfo[] = () => [...APPS]): ResolverComputer {
	const listApps = vi.fn<ComputerInterface["listApps"]>(async () => apps());
	const listAppIdentities = vi.fn<() => Promise<AppInfo[]>>(async () => apps());
	return { computer: { listApps, listAppIdentities }, listApps, listAppIdentities };
}

describe("#given a computer with an identity inventory #when an app name is resolved #then usage enrichment is skipped", () => {
	it("reads the identity inventory and never the usage-enriched list", async () => {
		const fake = resolverComputer();

		const pid = await resolveAppPid({ ...stubComputer(), ...fake.computer }, "notes");

		expect(pid).toBe(30);
		expect(fake.listAppIdentities).toHaveBeenCalledTimes(1);
		expect(fake.listApps).not.toHaveBeenCalled();
	});

	it("prefers an exact name or bundle id over a partial match", async () => {
		const fake = resolverComputer();
		const computer = { ...stubComputer(), ...fake.computer };

		expect(await resolveAppPid(computer, "Safari")).toBe(20);
		expect(await resolveAppPid(computer, "com.apple.safari")).toBe(20);
		expect(await resolveAppPid(computer, "technology")).toBe(10);
	});

	it("keeps partial-match precedence in inventory order when nothing matches exactly", async () => {
		const fake = resolverComputer();

		expect(await resolveAppPid({ ...stubComputer(), ...fake.computer }, "safa")).toBe(10);
	});

	it("reads the inventory on every call so a restarted app is never resolved to its old pid", async () => {
		let pid = 30;
		const fake = resolverComputer(() => [app("Notes", "com.apple.Notes", pid)]);
		const computer = { ...stubComputer(), ...fake.computer };

		expect(await resolveAppPid(computer, "Notes")).toBe(30);
		pid = 44;
		expect(await resolveAppPid(computer, "Notes")).toBe(44);
		expect(fake.listAppIdentities).toHaveBeenCalledTimes(2);
	});

	it("rejects an app that is not running", async () => {
		const fake = resolverComputer();

		await expect(resolveAppPid({ ...stubComputer(), ...fake.computer }, "Mail")).rejects.toThrow(
			'No running app matched "Mail"',
		);
	});

	it("answers a numeric pid without listing anything", async () => {
		const fake = resolverComputer();

		expect(await resolveAppPid({ ...stubComputer(), ...fake.computer }, "4242")).toBe(4242);
		expect(fake.listAppIdentities).not.toHaveBeenCalled();
		expect(fake.listApps).not.toHaveBeenCalled();
	});
});

describe("#given a computer without an identity inventory #when an app name is resolved #then it falls back to listApps", () => {
	it("resolves through listApps", async () => {
		const listApps = vi.fn<ComputerInterface["listApps"]>(async () => [...APPS]);

		const pid = await resolveAppPid({ ...stubComputer(), listApps }, "Notes");

		expect(pid).toBe(30);
		expect(listApps).toHaveBeenCalledTimes(1);
	});
});

function stubComputer(): ComputerInterface {
	return {
		capabilities: {
			supportsScreenshot: true,
			supportsInput: true,
			supportsAccessibility: true,
			supportsClipboard: true,
		},
		screenshot: vi.fn(),
		setTarget: vi.fn(),
		move: vi.fn(),
		click: vi.fn(),
		rightClick: vi.fn(),
		middleClick: vi.fn(),
		doubleClick: vi.fn(),
		type: vi.fn(),
		key: vi.fn(),
		scroll: vi.fn(),
		drag: vi.fn(),
		getCursorPosition: vi.fn(),
		getScreenSize: vi.fn(),
		getAppState: vi.fn(),
		getScreenshotViewport: vi.fn(),
		listApps: vi.fn(),
		setValue: vi.fn(),
		selectText: vi.fn(),
		performAction: vi.fn(),
		pressAtPosition: vi.fn(),
		typeIntoFocused: vi.fn(),
		assertObservationCurrent: vi.fn(),
		close: vi.fn(),
	};
}

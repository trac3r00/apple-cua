import { describe, expect, it, vi } from "vitest";

vi.mock("commander", () => ({
	Command: class {
		name() {
			return this;
		}
		description() {
			return this;
		}
		version() {
			return this;
		}
		option() {
			return this;
		}
		command() {
			return this;
		}
		argument() {
			return this;
		}
		action() {
			return this;
		}
		requiredOption() {
			return this;
		}
		addHelpText() {
			return this;
		}
		hook() {
			return this;
		}
		parseAsync() {
			return Promise.resolve();
		}
		parse() {
			return undefined;
		}
		opts() {
			return {};
		}
	},
}));
vi.mock("./browser-commands.js", () => ({ registerBrowserCommands: vi.fn() }));
vi.mock("./ios.js", () => ({ registerIosCommands: vi.fn() }));
vi.mock("./layout.js", () => ({
	resolveLayout() {
		return {};
	},
}));
vi.mock("./lifecycle-commands.js", () => ({
	registerLifecycleCommands: vi.fn(),
	resolveCursorMotion: vi.fn(),
}));
vi.mock("./utm.js", () => ({ registerUtmCommands: vi.fn() }));
vi.mock("@apple-cua/core", async (importOriginal) => await importOriginal<typeof import("@apple-cua/core")>());

import { waitForCursorOverlayAck } from "./cli.js";

interface TestOverlay {
	state(options?: { readonly deadlineMs?: number }): Promise<{
		x: number;
		y: number;
		shown: boolean;
		mode: string;
		reducedMotion: boolean;
	} | null>;
	setMode(): void;
}

describe("#given the daemon acknowledges before the deadline #when waiting #then it resolves true", () => {
	it("polls state without real delays", async () => {
		let time = 0;
		let queries = 0;
		const overlay: TestOverlay = {
			setMode: vi.fn(),
			async state() {
				queries += 1;
				return queries === 3 ? { x: 1, y: 2, shown: true, mode: "pointer", reducedMotion: false } : null;
			},
		};

		await expect(
			waitForCursorOverlayAck(overlay, {
				timeoutMs: 500,
				pollMs: 100,
				now: () => time,
				sleep: async (milliseconds) => {
					time += milliseconds;
				},
			}),
		).resolves.toBe(true);
		expect(queries).toBe(3);
	});
});

describe("#given a requested cursor mode #when another mode is visible #then it is not acknowledged", () => {
	it.each(["keyboard", "drag"])("rejects a visible pointer while requesting %s", async (requestedMode) => {
		const overlay: TestOverlay = {
			setMode: vi.fn(),
			async state() {
				return { x: 1, y: 2, shown: true, mode: "pointer", reducedMotion: false };
			},
		};
		let time = 0;

		await expect(
			waitForCursorOverlayAck(overlay, {
				requestedMode,
				timeoutMs: 100,
				now: () => time,
				sleep: async (milliseconds) => {
					time += milliseconds;
				},
			}),
		).resolves.toBe(false);
	});

	it("accepts a visible state matching the requested mode", async () => {
		const overlay: TestOverlay = {
			setMode: vi.fn(),
			async state() {
				return { x: 1, y: 2, shown: true, mode: "keyboard", reducedMotion: false };
			},
		};

		await expect(waitForCursorOverlayAck(overlay, { requestedMode: "keyboard" })).resolves.toBe(true);
	});
});

describe("#given a requested mode #when the daemon reports it without drawing the cursor #then it is acknowledged", () => {
	it("accepts the reported mode while the overlay is hidden", async () => {
		const overlay: TestOverlay = {
			setMode: vi.fn(),
			async state() {
				return { x: 1, y: 2, shown: false, mode: "pointer", reducedMotion: false };
			},
		};

		await expect(waitForCursorOverlayAck(overlay, { requestedMode: "pointer" })).resolves.toBe(true);
	});
});

describe("#given an acknowledgement arrives after its deadline #when waiting #then it resolves false", () => {
	it("rejects a late visible response", async () => {
		let time = 0;
		const overlay: TestOverlay = {
			setMode: vi.fn(),
			async state() {
				time = 251;
				return { x: 1, y: 2, shown: true, mode: "keyboard", reducedMotion: false };
			},
		};

		await expect(
			waitForCursorOverlayAck(overlay, { requestedMode: "keyboard", timeoutMs: 250, now: () => time }),
		).resolves.toBe(false);
	});

	it("returns false when the bounded query consumes the remaining budget", async () => {
		let time = 0;
		let receivedBudget = 0;
		const overlay: TestOverlay = {
			setMode: vi.fn(),
			async state(options) {
				receivedBudget = options?.deadlineMs ?? 0;
				time += receivedBudget;
				return null;
			},
		};

		await expect(waitForCursorOverlayAck(overlay, { timeoutMs: 250, now: () => time })).resolves.toBe(false);
		expect(receivedBudget).toBe(250);
		expect(time).toBe(250);
	});
});

describe("#given the daemon stays silent #when the acknowledgement deadline elapses #then it resolves false", () => {
	it("stops polling at the exact deadline", async () => {
		let time = 0;
		let queries = 0;
		const overlay: TestOverlay = {
			setMode: vi.fn(),
			async state() {
				queries += 1;
				return null;
			},
		};

		await expect(
			waitForCursorOverlayAck(overlay, {
				timeoutMs: 250,
				pollMs: 100,
				now: () => time,
				sleep: async (milliseconds) => {
					time += milliseconds;
				},
			}),
		).resolves.toBe(false);
		expect(time).toBe(250);
		expect(queries).toBe(3);
	});
});

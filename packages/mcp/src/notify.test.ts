import { afterEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { vi } from "@apple-cua/test-support";
import { createNotifier, notificationsEnabled, parseNotificationsEnabled } from "./notify.js";
import type { NotificationDependencies, NotificationProcess } from "./notify.js";

class FakeProcess extends EventEmitter implements NotificationProcess {
	readonly kill = vi.fn<(signal: NodeJS.Signals) => void>();
}

function dependencies(spawn: NotificationDependencies["spawn"], now = () => 0, timeoutMs = 5_000) {
	return { spawn, now, timeoutMs } satisfies NotificationDependencies;
}

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

describe("notification configuration", () => {
	it("#given the environment variable is absent #when notifications are queried #then they are enabled", () => {
		vi.stubEnv("APPLE_CUA_NOTIFICATIONS", undefined);
		expect(notificationsEnabled()).toBe(true);
		expect(parseNotificationsEnabled(undefined)).toBe(true);
	});

	it("#given the environment value is off #when parsed #then notifications are disabled", () => {
		expect(parseNotificationsEnabled(" OFF ")).toBe(false);
		expect(parseNotificationsEnabled("false")).toBe(true);
	});

	it("#given notifications are disabled #when requested #then no process is spawned", () => {
		vi.stubEnv("APPLE_CUA_NOTIFICATIONS", " off ");
		const spawn: NotificationDependencies["spawn"] = vi.fn(() => new FakeProcess());
		createNotifier(dependencies(spawn))("apple-cua", "restarted");
		expect(spawn).not.toHaveBeenCalled();
	});
});

describe("notification delivery", () => {
	it("#given an identical notification was sent #when requested within 10 seconds #then it is deduplicated", () => {
		vi.stubEnv("APPLE_CUA_NOTIFICATIONS", "on");
		let now = 100;
		const spawn: NotificationDependencies["spawn"] = vi.fn(() => new FakeProcess());
		const notify = createNotifier(dependencies(spawn, () => now));
		notify("apple-cua", "restarted");
		now = 10_099;
		notify("apple-cua", "restarted");
		expect(spawn).toHaveBeenCalledTimes(1);
		now = 10_100;
		notify("apple-cua", "restarted");
		expect(spawn).toHaveBeenCalledTimes(2);
	});

	it("#given spawning fails #when a notification is requested #then the failure is swallowed", () => {
		vi.stubEnv("APPLE_CUA_NOTIFICATIONS", "on");
		const notify = createNotifier(
			dependencies(() => {
				throw new Error("spawn failed");
			}),
		);
		expect(() => notify("apple-cua", "restarted")).not.toThrow();
	});

	it("#given title and body contain quotes and dashes #when spawned #then osascript receives one escaped argument", () => {
		vi.stubEnv("APPLE_CUA_NOTIFICATIONS", "on");
		const child = new FakeProcess();
		const spawn: NotificationDependencies["spawn"] = vi.fn((_command, _args) => child);
		const observeSpawn = vi.mocked(spawn);
		createNotifier(dependencies(spawn))('A "title" - x', 'Body "quoted" - text');
		expect(observeSpawn).toHaveBeenCalledWith("osascript", [
			"-e",
			expect.stringContaining('display notification "Body \\"quoted\\" - text" with title "A \\"title\\" - x"'),
		]);
		expect(child.listenerCount("close")).toBe(1);
		child.emit("close", 0);
	});

	it("#given osascript does not exit #when its deadline passes #then the child is terminated", () => {
		vi.stubEnv("APPLE_CUA_NOTIFICATIONS", "on");
		vi.useFakeTimers();
		const child = new FakeProcess();
		createNotifier(
			dependencies(
				() => child,
				() => 0,
				5,
			),
		)("apple-cua", "restarted");
		vi.advanceTimersByTime(5);
		expect(child.kill).toHaveBeenCalledWith("SIGTERM");
	});
});

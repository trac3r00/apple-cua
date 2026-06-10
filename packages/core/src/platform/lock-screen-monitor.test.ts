import { describe, expect, it, vi } from "vitest";

import { LockScreenMonitor } from "./lock-screen-monitor.js";

describe("#given a lock-screen monitor #when polled across transitions #then it fires lock/unlock once per edge", () => {
	it("fires onLock and onUnlock only on state changes, not while steady", () => {
		const onLock = vi.fn();
		const onUnlock = vi.fn();
		let locked = false;
		const monitor = new LockScreenMonitor(() => locked, { onLock, onUnlock });

		monitor.poll();
		monitor.poll();
		locked = true;
		monitor.poll();
		monitor.poll();
		locked = false;
		monitor.poll();

		expect(onLock).toHaveBeenCalledTimes(1);
		expect(onUnlock).toHaveBeenCalledTimes(1);
	});

	it("does not fire on the seeding poll when already locked", () => {
		const onLock = vi.fn();
		const monitor = new LockScreenMonitor(() => true, { onLock });

		monitor.poll();

		expect(onLock).not.toHaveBeenCalled();
	});
});

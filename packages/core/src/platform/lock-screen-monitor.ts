export interface LockScreenMonitorCallbacks {
	onLock?: () => void;
	onUnlock?: () => void;
}

export class LockScreenMonitor {
	private lastLocked: boolean | undefined;

	constructor(
		private readonly isLocked: () => boolean,
		private readonly callbacks: LockScreenMonitorCallbacks,
	) {}

	poll(): void {
		const now = this.isLocked();
		if (this.lastLocked !== undefined && now !== this.lastLocked) {
			if (now) {
				this.callbacks.onLock?.();
			} else {
				this.callbacks.onUnlock?.();
			}
		}
		this.lastLocked = now;
	}
}

import { spawn } from "node:child_process";

const DEDUPE_MS = 10_000;
const PROCESS_TIMEOUT_MS = 5_000;
export interface NotificationProcess {
	kill: (signal: NodeJS.Signals) => void;
	once(event: "error", listener: (error: unknown) => void): NotificationProcess;
	once(event: "close", listener: (code: number | null) => void): NotificationProcess;
}

export interface NotificationDependencies {
	readonly spawn: (command: string, args: readonly string[]) => NotificationProcess;
	readonly now: () => number;
	readonly timeoutMs: number;
}

export function parseNotificationsEnabled(value: string | undefined): boolean {
	return value?.trim().toLowerCase() !== "off";
}

export function notificationsEnabled(): boolean {
	return parseNotificationsEnabled(process.env["APPLE_CUA_NOTIFICATIONS"]);
}

const defaultDependencies: NotificationDependencies = {
	spawn: (command, args) => spawn(command, [...args]),
	now: Date.now,
	timeoutMs: PROCESS_TIMEOUT_MS,
};

export function createNotifier(dependencies: NotificationDependencies = defaultDependencies) {
	const recent = new Map<string, number>();
	return (title: string, body: string, options?: { readonly subtitle?: string }): void => {
		if (!notificationsEnabled()) return;

		const now = dependencies.now();
		for (const [key, sentAt] of recent) {
			if (now - sentAt >= DEDUPE_MS) recent.delete(key);
		}
		const key = JSON.stringify([title, body]);
		const sentAt = recent.get(key);
		if (sentAt !== undefined && now - sentAt < DEDUPE_MS) return;
		recent.set(key, now);

		const escapeAppleScript = (value: string) => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
		const subtitle = options?.subtitle === undefined ? "" : ` subtitle "${escapeAppleScript(options.subtitle)}"`;
		const script = `on run argv\ndisplay notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}"${subtitle}\nend run`;
		let child: NotificationProcess;
		try {
			child = dependencies.spawn("osascript", ["-e", script]);
		} catch {
			return;
		}

		let settled = false;
		const timeout = setTimeout(() => {
			if (settled) return;
			settled = true;
			try {
				child.kill("SIGTERM");
			} catch {
				// Notification delivery is best-effort.
			}
		}, dependencies.timeoutMs);
		child.once("error", () => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
		});
		child.once("close", () => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
		});
	};
}

export const postNotification = createNotifier();

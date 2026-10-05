import { type ListedWindow, listWindows } from "./macos-ffi/window-list.js";

/** What a person has to do with the dialog: grant a permission, authenticate, or answer an alert. */
export type SystemPromptKind = "permission" | "authentication" | "system-alert";

/** A dialog macOS itself put on screen, which only the person at the Mac can answer. */
export interface SystemPrompt {
	readonly windowId: number;
	readonly ownerPid: number;
	readonly owner: string;
	readonly title: string;
	readonly kind: SystemPromptKind;
	readonly bounds: ListedWindow["bounds"];
}

/**
 * System agents that put a dialog in front of every app: the Accessibility / Screen Recording
 * request, password and Touch ID sheets, and alerts such as "downloaded from the internet". None
 * of them belongs to the app being driven, so an app observation never shows them, yet they can
 * block input or a capture until the person answers. These agents have no localized display name,
 * so their window-server owner name is the executable name matched here.
 */
const SYSTEM_PROMPT_OWNERS: ReadonlyMap<string, SystemPromptKind> = new Map([
	["universalAccessAuthWarn", "permission"],
	["SecurityAgent", "authentication"],
	["coreautha", "authentication"],
	["UserNotificationCenter", "system-alert"],
	["CoreServicesUIAgent", "system-alert"],
]);

/** A window this small is a placeholder the agent keeps around, not a dialog anyone can see. */
const MIN_PROMPT_EDGE = 20;

export function classifySystemPrompts(windows: readonly ListedWindow[]): readonly SystemPrompt[] {
	const prompts: SystemPrompt[] = [];
	for (const window of windows) {
		const kind = SYSTEM_PROMPT_OWNERS.get(window.ownerName);
		if (kind === undefined || window.bounds.width < MIN_PROMPT_EDGE || window.bounds.height < MIN_PROMPT_EDGE) {
			continue;
		}
		prompts.push({
			windowId: window.id,
			ownerPid: window.ownerPid,
			owner: window.ownerName,
			title: window.title,
			kind,
			bounds: window.bounds,
		});
	}
	return prompts;
}

let windowSource: () => readonly ListedWindow[] | undefined = () => listWindows({ onScreenOnly: true });

/** Test seam: production reads the live window server; a test pins the windows it reasons about. */
export function setSystemPromptWindowSourceForTesting(
	source: (() => readonly ListedWindow[] | undefined) | undefined,
): void {
	windowSource = source ?? (() => listWindows({ onScreenOnly: true }));
}

/** System dialogs on screen right now; an unreadable window list is reported as none rather than failing. */
export function currentSystemPrompts(): readonly SystemPrompt[] {
	const windows = windowSource();
	return windows === undefined ? [] : classifySystemPrompts(windows);
}

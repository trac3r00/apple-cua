import { afterEach, describe, expect, it } from "vitest";
import type { ListedWindow } from "./macos-ffi/window-list.js";
import {
	classifySystemPrompts,
	currentSystemPrompts,
	setSystemPromptWindowSourceForTesting,
} from "./system-prompts.js";

const window = (ownerName: string, title: string, width = 520, height = 220, id = 1): ListedWindow => ({
	id,
	ownerPid: 100 + id,
	layer: 0,
	ownerName,
	title,
	bounds: { x: 10, y: 20, width, height },
});

afterEach(() => {
	setSystemPromptWindowSourceForTesting(undefined);
});

describe("#given the windows on screen #when apple-cua looks for dialogs only the person can answer", () => {
	it("#then a permission request, a password sheet and a system alert are named with their kind", () => {
		const prompts = classifySystemPrompts([
			window("universalAccessAuthWarn", "Screen Recording", 520, 220, 1),
			window("SecurityAgent", "", 440, 300, 2),
			window("CoreServicesUIAgent", "", 460, 200, 3),
		]);

		expect(prompts.map((prompt) => [prompt.owner, prompt.kind, prompt.windowId])).toEqual([
			["universalAccessAuthWarn", "permission", 1],
			["SecurityAgent", "authentication", 2],
			["CoreServicesUIAgent", "system-alert", 3],
		]);
		expect(prompts[0]?.title).toBe("Screen Recording");
	});

	it("#then ordinary app windows and the agents' invisible placeholder windows are not prompts", () => {
		expect(
			classifySystemPrompts([
				window("TextEdit", "document.txt"),
				window("Finder", "cua-bench"),
				window("universalAccessAuthWarn", "", 1, 1),
			]),
		).toEqual([]);
	});

	it("#then an unreadable window list reports no prompts instead of failing the observation", () => {
		setSystemPromptWindowSourceForTesting(() => undefined);

		expect(currentSystemPrompts()).toEqual([]);
	});
});

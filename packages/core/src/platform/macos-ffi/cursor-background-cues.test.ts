import { describe, expect, it } from "bun:test";

import { CURSOR_BACKGROUND_CUES_ENV, cursorBackgroundCuesEnabled } from "./cursor-background-cues.js";

describe("#given background cue configuration #when parsing the environment #then only off disables cues", () => {
	it("defaults to enabled and ignores invalid values", () => {
		expect(cursorBackgroundCuesEnabled({})).toBe(true);
		expect(cursorBackgroundCuesEnabled({ [CURSOR_BACKGROUND_CUES_ENV]: "sometimes" })).toBe(true);
	});

	it("disables cues for a trimmed case-insensitive off value", () => {
		expect(cursorBackgroundCuesEnabled({ [CURSOR_BACKGROUND_CUES_ENV]: " OFF " })).toBe(false);
	});
});

import { describe, expect, it } from "bun:test";

import {
	DEFAULT_HISTORY_OBSERVATION_SETTINGS,
	type HistoryObservationSettings,
	shouldObserve,
} from "./history-settings.js";

describe("#given default observe behavior #when deciding to observe #then unmatched apps record", () => {
	it("records an app with no rule", () => {
		expect(shouldObserve({ bundleId: "com.apple.finder" }, DEFAULT_HISTORY_OBSERVATION_SETTINGS)).toBe(true);
	});
});

describe("#given a blocklist rule under default observe #when the app matches #then it is excluded", () => {
	it("a block rule wins over the observe default", () => {
		const settings: HistoryObservationSettings = {
			...DEFAULT_HISTORY_OBSERVATION_SETTINGS,
			rules: [{ scope: "app", bundleID: "com.apple.Safari", behavior: "do_not_observe" }],
		};
		expect(shouldObserve({ bundleId: "com.apple.safari" }, settings)).toBe(false);
	});
});

describe("#given default do_not_observe with an allowlist #when the app matches #then only it records", () => {
	it("records the allowlisted app and nothing else", () => {
		const settings: HistoryObservationSettings = {
			...DEFAULT_HISTORY_OBSERVATION_SETTINGS,
			defaultApplicationBehavior: "do_not_observe",
			rules: [{ scope: "app", bundleID: "com.apple.Terminal", behavior: "observe" }],
		};
		expect(shouldObserve({ bundleId: "com.apple.Terminal" }, settings)).toBe(true);
		expect(shouldObserve({ bundleId: "com.apple.finder" }, settings)).toBe(false);
	});
});

describe("#given a browser record with a URL #when app and URL policies disagree #then both must allow it", () => {
	it("blocks when the URL policy blocks even though the app is observed", () => {
		const settings: HistoryObservationSettings = {
			...DEFAULT_HISTORY_OBSERVATION_SETTINGS,
			rules: [{ scope: "url", urlDomain: "example.com", behavior: "do_not_observe" }],
		};
		expect(shouldObserve({ bundleId: "com.brave.Browser", url: "https://app.example.com/x" }, settings)).toBe(false);
	});

	it("matches a bare domain rule against its subdomains", () => {
		const settings: HistoryObservationSettings = {
			...DEFAULT_HISTORY_OBSERVATION_SETTINGS,
			defaultURLBehavior: "do_not_observe",
			rules: [{ scope: "url", urlDomain: "example.com", behavior: "observe" }],
		};
		expect(shouldObserve({ bundleId: "com.brave.Browser", url: "https://docs.example.com" }, settings)).toBe(true);
		expect(shouldObserve({ bundleId: "com.brave.Browser", url: "https://other.test" }, settings)).toBe(false);
	});
});

describe("#given private browsing #when deciding to observe #then it follows the opt-out setting", () => {
	it("records private windows by default and skips them once excluded", () => {
		const context = { bundleId: "com.brave.Browser", privateBrowsing: true };
		expect(shouldObserve(context, DEFAULT_HISTORY_OBSERVATION_SETTINGS)).toBe(true);
		expect(shouldObserve(context, { ...DEFAULT_HISTORY_OBSERVATION_SETTINGS, observePrivateBrowsing: false })).toBe(
			false,
		);
	});
});

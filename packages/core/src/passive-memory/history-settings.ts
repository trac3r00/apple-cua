export type ObservationDefaultBehavior = "observe" | "do_not_observe";

export interface AppObservationRule {
	readonly scope: "app";
	readonly bundleID: string;
	readonly behavior: ObservationDefaultBehavior;
}

export interface UrlObservationRule {
	readonly scope: "url";
	readonly urlDomain: string;
	readonly behavior: ObservationDefaultBehavior;
}

export type ObservationRule = AppObservationRule | UrlObservationRule;

export interface HistoryObservationSettings {
	readonly defaultApplicationBehavior: ObservationDefaultBehavior;
	readonly defaultURLBehavior: ObservationDefaultBehavior;
	readonly observePrivateBrowsing: boolean;
	readonly rules: readonly ObservationRule[];
}

export interface HistoryObservationContext {
	readonly bundleId: string;
	readonly url?: string;
	readonly privateBrowsing?: boolean;
}

export const DEFAULT_HISTORY_OBSERVATION_SETTINGS: HistoryObservationSettings = {
	defaultApplicationBehavior: "observe",
	defaultURLBehavior: "observe",
	// The user chose to record every app by default, private windows included, and exclude apps one by one.
	observePrivateBrowsing: true,
	rules: [],
};

function hostFromUrl(url: string): string | undefined {
	try {
		return new URL(url).hostname.toLowerCase() || undefined;
	} catch {
		return undefined;
	}
}

function domainMatches(host: string, ruleDomain: string): boolean {
	const domain = ruleDomain.toLowerCase();
	return host === domain || host.endsWith(`.${domain}`);
}

function resolveScope(
	matching: readonly ObservationDefaultBehavior[],
	defaultBehavior: ObservationDefaultBehavior,
): boolean {
	if (matching.includes("do_not_observe")) {
		return false;
	}
	if (matching.includes("observe")) {
		return true;
	}
	return defaultBehavior === "observe";
}

export function shouldObserve(context: HistoryObservationContext, settings: HistoryObservationSettings): boolean {
	if (context.privateBrowsing === true && !settings.observePrivateBrowsing) {
		return false;
	}

	const bundleId = context.bundleId.toLowerCase();
	const appMatches = settings.rules
		.filter((rule): rule is AppObservationRule => rule.scope === "app" && rule.bundleID.toLowerCase() === bundleId)
		.map((rule) => rule.behavior);
	const appObserve = resolveScope(appMatches, settings.defaultApplicationBehavior);

	if (context.url === undefined) {
		return appObserve;
	}

	const host = hostFromUrl(context.url);
	if (host === undefined) {
		return appObserve;
	}

	const urlMatches = settings.rules
		.filter((rule): rule is UrlObservationRule => rule.scope === "url" && domainMatches(host, rule.urlDomain))
		.map((rule) => rule.behavior);
	const urlObserve = resolveScope(urlMatches, settings.defaultURLBehavior);

	return appObserve && urlObserve;
}

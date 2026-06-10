import { blockedUrl } from "../permission/url-blocklist.js";

export interface PassiveMemoryContext {
	bundleId: string;
	url?: string;
}

export interface PassiveMemoryConfig {
	enabled: boolean;
	excludedBundleIds?: readonly string[];
	excludedUrlPatterns?: readonly string[];
}

export function shouldRecord(context: PassiveMemoryContext, config: PassiveMemoryConfig): boolean {
	if (!config.enabled) {
		return false;
	}
	const bundleId = context.bundleId.toLowerCase();
	if ((config.excludedBundleIds ?? []).some((excluded) => excluded.toLowerCase() === bundleId)) {
		return false;
	}
	if (context.url !== undefined && blockedUrl(context.url, config.excludedUrlPatterns ?? [])) {
		return false;
	}
	return true;
}

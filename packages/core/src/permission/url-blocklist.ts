export function blockedUrl(url: string, patterns: readonly string[]): boolean {
	return patterns.some((pattern) => patternToRegExp(pattern).test(url));
}

function patternToRegExp(pattern: string): RegExp {
	const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
	return new RegExp(`^${escaped}$`);
}

const BROWSER_BUNDLE_URL_SCRIPT: ReadonlyMap<string, string> = new Map([
	["com.apple.safari", 'tell application "Safari" to get URL of current tab of front window'],
	["com.google.chrome", 'tell application "Google Chrome" to get URL of active tab of front window'],
	["com.microsoft.edgemac", 'tell application "Microsoft Edge" to get URL of active tab of front window'],
	["company.thebrowser.browser", 'tell application "Arc" to get URL of active tab of front window'],
]);

export function isBrowserBundle(bundleId: string): boolean {
	return BROWSER_BUNDLE_URL_SCRIPT.has(bundleId.toLowerCase());
}

export function browserUrlScript(bundleId: string): string | undefined {
	return BROWSER_BUNDLE_URL_SCRIPT.get(bundleId.toLowerCase());
}

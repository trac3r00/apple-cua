export type ObservationProfile = "fast" | "full" | "visual";

export type ObservationDefaults = {
	readonly includeScreenshot?: boolean;
	readonly includeAccessibilityTree?: boolean;
	readonly settleMs?: number;
	readonly maxElements?: number;
	readonly elementFormat?: "json" | "table";
};

export function profileDefaults(profile: ObservationProfile | undefined): ObservationDefaults {
	switch (profile) {
		case "fast":
			return { includeScreenshot: false, settleMs: 0, maxElements: 250, elementFormat: "table" };
		case "visual":
			return { includeScreenshot: true, includeAccessibilityTree: false };
		case "full":
		case undefined:
			return {};
	}
}

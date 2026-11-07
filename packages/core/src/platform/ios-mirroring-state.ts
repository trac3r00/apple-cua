// Pure iPhone Mirroring facts, kept apart from ios-mirroring.ts so status text loads without the native bindings.
export const IPHONE_MIRRORING_BUNDLE_ID = "com.apple.ScreenContinuity";
export const IPHONE_MIRRORING_APP_NAME = "iPhone Mirroring";

export type MirroringSessionState = "ready" | "blocked" | "no-window" | "not-running";

/** What the user has to do about a session that is not ready. Never a tap-through instruction. */
export function describeMirroringState(state: MirroringSessionState, detail?: string): string {
	switch (state) {
		case "ready":
			return `${IPHONE_MIRRORING_APP_NAME} is connected and ready.`;
		case "not-running":
			return `${IPHONE_MIRRORING_APP_NAME} isn't running — open the ${IPHONE_MIRRORING_APP_NAME} app and connect your phone, then retry. Reconnecting is physical, so I can't do it for you.`;
		case "no-window":
			return `${IPHONE_MIRRORING_APP_NAME} is open but no phone is connected. Connect your phone in the app, then retry.`;
		case "blocked":
			return [
				`${IPHONE_MIRRORING_APP_NAME} is not connected — an interstitial is on screen.`,
				detail === undefined ? "" : `It says: ${detail}`,
				'This needs you: clear it on the Mac, and if it says "iPhone in Use", lock your iPhone so mirroring can resume. Then retry — I will not tap Connect for you.',
			]
				.filter((part) => part.length > 0)
				.join(" ");
	}
}

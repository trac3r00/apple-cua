export const CURSOR_BACKGROUND_CUES_ENV = "OPENCUA_CURSOR_BACKGROUND_CUES";

export function cursorBackgroundCuesEnabled(
	environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
	return environment[CURSOR_BACKGROUND_CUES_ENV]?.trim().toLowerCase() !== "off";
}

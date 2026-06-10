export const SCREEN_LOCKED_MESSAGE =
	"Computer Use is paused because the Mac is locked. Ask the user to unlock the Mac before continuing.";

export function assertScreenUnlocked(isLocked: boolean): void {
	if (isLocked) {
		throw new Error(SCREEN_LOCKED_MESSAGE);
	}
}

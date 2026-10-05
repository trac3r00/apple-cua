/**
 * How long one accessibility message may wait for its app to answer.
 *
 * Without a bound, an app that is busy — loading a page, sitting on a modal sheet, or simply not
 * scheduled — leaves the AX call blocked with no reply. That is the wedge: the observation never
 * returns, and everything queued behind it times out too. Two seconds is generous for a round trip
 * that normally takes microseconds, and finite.
 */
export const DEFAULT_AX_MESSAGING_TIMEOUT_SECONDS = 2;

/** The AX error an app returns when it did not answer inside the messaging timeout. */
export const AX_ERROR_CANNOT_COMPLETE = -25204;

export function resolveAxMessagingTimeoutSeconds(environment: NodeJS.ProcessEnv = process.env): number {
	const raw = environment["APPLE_CUA_AX_TIMEOUT_SECONDS"];
	if (raw === undefined || raw.trim() === "") {
		return DEFAULT_AX_MESSAGING_TIMEOUT_SECONDS;
	}
	const parsed = Number.parseFloat(raw);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_AX_MESSAGING_TIMEOUT_SECONDS;
}

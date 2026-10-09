import { describeMirroringState, describeUserStop } from "@apple-cua/core";
import type { MirroringObservation, StopStatus } from "@apple-cua/core";

export interface PhoneContextFailure {
	readonly reason: string;
	readonly message: string;
	readonly inputAttempted?: boolean;
	readonly actionDispatched?: boolean;
}

/** The same context check applies before input and before issuing continuation authority. */
export function phoneContextFailure(
	previous: MirroringObservation,
	current: MirroringObservation,
	stop: StopStatus | undefined,
): PhoneContextFailure | undefined {
	if (stop?.stopped === true) return { reason: "user-stopped", message: describeUserStop(stop) };
	if (current.state !== "ready") return { reason: "phone-not-ready", message: describeMirroringState(current.state) };
	const before = previous.window;
	const after = current.window;
	if (
		after.id !== before.id ||
		after.x !== before.x ||
		after.y !== before.y ||
		after.width !== before.width ||
		after.height !== before.height
	)
		return {
			reason: "phone-window-changed",
			message: "the observed iPhone Mirroring window moved, resized, or changed",
		};
	return undefined;
}

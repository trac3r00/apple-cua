import { createHash } from "node:crypto";
import type { HotFrameSource, InputObservation } from "@apple-cua/core";
import { captureWindowViaSck } from "@apple-cua/core";

/** One canonical JPEG binds cache identity, gateway pixels, and dispatch staleness checks. */
export function latestDecisionFrame(
	hotFrames: Pick<HotFrameSource, "latestFor">,
	surface: Pick<InputObservation, "pid" | "windowId"> | undefined,
): { readonly hash: string; readonly image: string; readonly surface: string } | undefined {
	if (surface === undefined) {
		return undefined;
	}
	const frame = hotFrames.latestFor(surface.pid, surface.windowId);
	if (frame === undefined) {
		return undefined;
	}
	let image = captureWindowViaSck(surface.windowId, 320, 200, "jpeg", 30);
	if (image !== null && image.byteLength > 20_000) {
		image = captureWindowViaSck(surface.windowId, 320, 200, "jpeg", 20);
	}
	if (image === null || image.byteLength > 20_000) {
		return undefined;
	}
	return {
		hash: createHash("sha1").update(image).digest("hex"),
		image: image.toString("base64"),
		surface: `${surface.pid}:${surface.windowId}`,
	};
}

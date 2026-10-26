import type { HotFrameSource, InputObservation } from "@apple-cua/core";
import { captureWindowViaSck } from "@apple-cua/core";

/** Keep hot-frame identity for caching and stale guards, but never send its full-size JPEG. */
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
	let image = captureWindowViaSck(surface.windowId, 480, 300, "jpeg", 50);
	if (image !== null && image.byteLength > 20_000) {
		image = captureWindowViaSck(surface.windowId, 320, 200, "jpeg", 30);
	}
	if (image === null || image.byteLength > 20_000) {
		return undefined;
	}
	return { hash: frame.hash, image: image.toString("base64"), surface: `${surface.pid}:${surface.windowId}` };
}

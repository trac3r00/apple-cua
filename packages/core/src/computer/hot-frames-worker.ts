import { createHash } from "node:crypto";
import { parentPort } from "node:worker_threads";
import { parseImageDimensions } from "../platform/image-format.js";
import { captureWindowViaSck } from "../platform/macos-ffi/sckit.js";

export interface HotFramesJob {
	readonly type: "target";
	readonly windowId: number;
	readonly width: number;
	readonly height: number;
	readonly quality: number;
}

interface ParentPort {
	postMessage(message: unknown, transfer?: readonly unknown[]): void;
	on(event: "message", listener: (message: unknown) => void): void;
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolvePromise) => {
		setTimeout(resolvePromise, milliseconds);
	});
}

const port = parentPort as ParentPort | null;
let job: HotFramesJob | undefined;
let stopping = false;

port?.on("message", (message: unknown) => {
	if (typeof message !== "object" || message === null || !("type" in message)) {
		return;
	}
	if (message.type === "stop") {
		stopping = true;
		return;
	}
	const candidate = message as HotFramesJob;
	if (
		candidate.type === "target" &&
		Number.isSafeInteger(candidate.windowId) &&
		candidate.windowId > 0 &&
		Number.isSafeInteger(candidate.width) &&
		candidate.width > 0 &&
		Number.isSafeInteger(candidate.height) &&
		candidate.height > 0
	) {
		job = candidate;
	}
});

port?.postMessage("ready");

void (async () => {
	while (true) {
		if (stopping) {
			process.exit(0);
		}
		const current = job;
		if (current === undefined) {
			await delay(20);
			continue;
		}
		try {
			const data = captureWindowViaSck(current.windowId, current.width, current.height, "jpeg", current.quality);
			if (data !== null && data.length > 0 && port !== null) {
				const dimensions = parseImageDimensions(data);
				const hash = createHash("sha1").update(data).digest("hex");
				const bytes = new Uint8Array(data.byteLength);
				bytes.set(data);
				port.postMessage(
					{
						type: "frame",
						bytes,
						width: dimensions.width,
						height: dimensions.height,
						capturedAt: Date.now(),
						hash,
					},
					[bytes.buffer],
				);
				await delay(1);
			} else {
				await delay(20);
			}
		} catch {
			await delay(40);
		}
	}
})();

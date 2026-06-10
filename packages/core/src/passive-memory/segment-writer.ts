import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type PassiveMemoryConfig, type PassiveMemoryContext, shouldRecord } from "./exclusion-policy.js";

export interface SegmentSink {
	write(path: string, bytes: Buffer): Promise<void>;
}

export const fileSegmentSink: SegmentSink = {
	async write(path: string, bytes: Buffer): Promise<void> {
		await writeFile(path, bytes, { mode: 0o600 });
	},
};

export class PassiveMemorySegmentWriter {
	constructor(
		private readonly config: PassiveMemoryConfig,
		private readonly directory: string,
		private readonly sink: SegmentSink = fileSegmentSink,
		private readonly now: () => number = Date.now,
	) {}

	async capture(context: PassiveMemoryContext, screenshot: () => Promise<Buffer>): Promise<string | undefined> {
		if (!shouldRecord(context, this.config)) {
			return undefined;
		}
		const bytes = await screenshot();
		const path = join(this.directory, `segment-${this.now()}.png`);
		await this.sink.write(path, bytes);
		return path;
	}
}

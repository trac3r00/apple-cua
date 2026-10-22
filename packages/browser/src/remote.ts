import { z } from "zod";
import { readConnection } from "./connection.js";
import { BrowserError, type BrowserErrorCode } from "./protocol.js";
import type { BrowserControllerLike } from "./server.js";

const replySchema = z.object({ error: z.string(), message: z.string() });
const CODES: Record<string, BrowserErrorCode> = {
	disconnected: "disconnected",
	timeout: "timeout",
	stopped: "stopped",
	stale: "stale",
	extension: "extension",
	busy: "busy",
	"not-found": "not-found",
	unsupported: "unsupported",
};

export class RemoteBrowserController implements BrowserControllerLike {
	constructor(
		private readonly port: number,
		private readonly token: string,
		private readonly timeoutMs = 20000,
	) {}

	async dispatch(value: unknown, signal?: AbortSignal): Promise<unknown> {
		const timeout = AbortSignal.timeout(this.timeoutMs);
		const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
		let response: Response;
		try {
			response = await fetch(`http://127.0.0.1:${this.port}/rpc`, {
				method: "POST",
				headers: {
					authorization: `Bearer ${this.token}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(value),
				signal: combined,
			});
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			throw new BrowserError(
				"disconnected",
				`The background browser daemon is not reachable on 127.0.0.1:${this.port}: ${detail}. Run: apple-cua browser setup`,
			);
		}
		const result: unknown = await response.json();
		if (!response.ok) {
			const failure = replySchema.safeParse(result);
			throw new BrowserError(
				failure.success ? (CODES[failure.data.error] ?? "extension") : "extension",
				failure.success ? failure.data.message : `Browser RPC returned HTTP ${response.status}`,
			);
		}
		return result;
	}
}

export async function connectBrowserController(stateDirectory?: string): Promise<BrowserControllerLike> {
	const connection = await readConnection(stateDirectory);
	return new RemoteBrowserController(connection.port, connection.token);
}

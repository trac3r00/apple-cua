import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MAX_PROMPT_BYTES = 120_000;
const MAX_OUTPUT_BYTES = 256 * 1024;
const TIMEOUT_MILLISECONDS = 120_000;
const ARGUMENTS = [
	"--print",
	"--no-session",
	"--no-tools",
	"--no-extensions",
	"--no-skills",
	"--no-context-files",
	"--no-approve",
	"--offline",
	"-",
];

export interface HistoryAgentOptions {
	readonly signal?: AbortSignal;
	readonly executable?: string;
}

type StopReason = "abort" | "timeout" | "oversize";

function defaultExecutable(): string {
	const configured = process.env["OPENCUA_HISTORY_AGENT"];
	if (configured) {
		return configured;
	}

	const installed = join(homedir(), ".bun", "bin", "omo");
	return existsSync(installed) ? installed : "omo";
}

export async function generateHistoryText(prompt: string, options: HistoryAgentOptions = {}): Promise<string> {
	if (Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES) {
		throw new Error(`History generation prompt exceeds ${MAX_PROMPT_BYTES} UTF-8 bytes.`);
	}
	if (options.signal?.aborted) {
		throw new Error("History generation aborted.");
	}

	const executable = options.executable ?? defaultExecutable();

	return await new Promise<string>((resolve, reject) => {
		const stdoutChunks: Buffer[] = [];
		let stderrBytes = 0;
		let stdoutBytes = 0;
		let stopReason: StopReason | undefined;
		let spawnError: Error | undefined;
		let settled = false;
		const child = spawn(executable, ARGUMENTS, { stdio: ["pipe", "pipe", "pipe"] });
		const timer = setTimeout(() => stop("timeout"), TIMEOUT_MILLISECONDS);

		const cleanup = (): void => {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
		};

		const stop = (reason: StopReason): void => {
			if (stopReason !== undefined) {
				return;
			}
			stopReason = reason;
			child.kill("SIGKILL");
		};

		const onAbort = (): void => stop("abort");
		options.signal?.addEventListener("abort", onAbort, { once: true });
		child.stdout.on("data", (chunk: Buffer) => {
			stdoutBytes += chunk.length;
			if (stdoutBytes > MAX_OUTPUT_BYTES) {
				stop("oversize");
				return;
			}
			stdoutChunks.push(chunk);
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderrBytes += chunk.length;
			if (stderrBytes > MAX_OUTPUT_BYTES) {
				stop("oversize");
			}
		});
		child.on("error", (error: Error) => {
			spawnError = error;
		});
		child.on("close", (code: number | null) => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			if (stopReason === "abort") {
				reject(new Error("History generation aborted."));
			} else if (stopReason === "timeout") {
				reject(new Error(`History generation timed out after ${TIMEOUT_MILLISECONDS / 1000} seconds.`));
			} else if (stopReason === "oversize") {
				reject(new Error(`History generation output exceeds ${MAX_OUTPUT_BYTES} bytes.`));
			} else if (spawnError) {
				reject(new Error(`History generation executable is unavailable: ${executable}.`));
			} else if (code !== 0) {
				reject(new Error(`History generation failed with exit code ${code ?? "unknown"}.`));
			} else if (Buffer.concat(stdoutChunks).toString("utf8").trim().length === 0) {
				reject(new Error("History generation returned empty text."));
			} else {
				resolve(Buffer.concat(stdoutChunks).toString("utf8").trim());
			}
		});
		child.stdin.on("error", () => {
			// A child that exits before consuming stdin is classified from its close event.
		});
		child.stdin.end(prompt, "utf8");
	});
}

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Who flipped the switch: the keyboard chord, the `apple-cua stop` command, or code calling the API. */
export type StopSource = "chord" | "cli" | "api";

export type StopStatus =
	| { readonly stopped: false }
	| { readonly stopped: true; readonly stoppedAt: string; readonly reason: string; readonly source: StopSource };

/** The read side of the switch: all a gate needs to know. */
export interface StopStatusSource {
	status(): StopStatus;
}

/** Environment variable that relocates the state directory (default `~/.apple-cua`). */
export const STATE_DIR_ENV = "APPLE_CUA_STATE_DIR";
const STOP_FILE_NAME = "stop.json";
const MALFORMED_REASON = "malformed stop file";

export function resolveStateDir(env: NodeJS.ProcessEnv = process.env): string {
	const configured = env[STATE_DIR_ENV];
	return configured !== undefined && configured !== "" ? configured : join(homedir(), ".apple-cua");
}

function isStopSource(value: unknown): value is StopSource {
	return value === "chord" || value === "cli" || value === "api";
}

/**
 * A file-backed, machine-wide stop switch. Every apple-cua process reads the same file, so one
 * stop halts every agent, and only a human running `resume` (or deleting the file) lifts it.
 * A stop file that cannot be parsed counts as stopped: failing closed is the safe answer for a
 * kill switch.
 */
export class StopSwitch implements StopStatusSource {
	readonly path: string;

	constructor(stateDir: string = resolveStateDir()) {
		this.path = join(stateDir, STOP_FILE_NAME);
	}

	/** Stop computer use; the state file is written atomically (temp file, then rename). */
	stop(reason: string, source: StopSource): StopStatus & { readonly stopped: true } {
		const status = { stopped: true, stoppedAt: new Date().toISOString(), reason, source } as const;
		mkdirSync(dirname(this.path), { recursive: true });
		const temporary = `${this.path}.${process.pid}.tmp`;
		writeFileSync(temporary, `${JSON.stringify({ stoppedAt: status.stoppedAt, reason, source })}\n`);
		renameSync(temporary, this.path);
		return status;
	}

	/** Lift the stop. Returns whether a stop was in force. */
	resume(): boolean {
		const wasStopped = this.status().stopped;
		rmSync(this.path, { force: true });
		return wasStopped;
	}

	status(): StopStatus {
		let raw: string;
		try {
			raw = readFileSync(this.path, "utf8");
		} catch (error: unknown) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") {
				return { stopped: false };
			}
			return malformedStop();
		}
		try {
			const parsed: unknown = JSON.parse(raw);
			if (typeof parsed === "object" && parsed !== null) {
				const { stoppedAt, reason, source } = Object.fromEntries(Object.entries(parsed));
				if (typeof stoppedAt === "string" && typeof reason === "string" && isStopSource(source)) {
					return { stopped: true, stoppedAt, reason, source };
				}
			}
		} catch {
			// fall through: an unreadable stop file is a stop
		}
		return malformedStop();
	}
}

function malformedStop(): StopStatus {
	return { stopped: true, stoppedAt: new Date(0).toISOString(), reason: MALFORMED_REASON, source: "api" };
}

/** The sentence an agent is shown when the stop refuses its input. */
export function describeUserStop(status: StopStatus & { readonly stopped: true }): string {
	return `The user stopped computer use (${status.source} at ${status.stoppedAt}). Do not retry or try to resume; tell the user. They resume with \`apple-cua resume\`.`;
}

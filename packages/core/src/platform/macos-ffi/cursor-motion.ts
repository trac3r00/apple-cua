import type { Socket } from "node:net";
import { planMove } from "../../../vendor/cua-cursor-motion.js";
import type { Point } from "../../types/index.js";
import type { CursorMotionConfig } from "./cursor-motion-config.js";

export interface CursorState extends Point {
	readonly shown: boolean;
	readonly reducedMotion: boolean;
	/** Native-reported overlay mode; absent on daemon builds that predate mode reporting. */
	readonly mode?: string;
}

function parseState(text: string): CursorState {
	const value: unknown = JSON.parse(text);
	if (
		typeof value !== "object" ||
		value === null ||
		!("x" in value) ||
		typeof value.x !== "number" ||
		!Number.isFinite(value.x) ||
		!("y" in value) ||
		typeof value.y !== "number" ||
		!Number.isFinite(value.y) ||
		!("shown" in value) ||
		typeof value.shown !== "boolean" ||
		!("reducedMotion" in value) ||
		typeof value.reducedMotion !== "boolean"
	) {
		throw new Error("Invalid cursor overlay state");
	}
	const record = value as { x: number; y: number; shown: boolean; reducedMotion: boolean; mode?: unknown };
	// "mode" is optional: daemon builds that predate mode reporting simply omit it.
	if (record.mode !== undefined && typeof record.mode !== "string") {
		throw new Error("Invalid cursor overlay state");
	}
	return {
		x: record.x,
		y: record.y,
		shown: record.shown,
		reducedMotion: record.reducedMotion,
		...(typeof record.mode === "string" ? { mode: record.mode } : {}),
	};
}

export function parseCursorState(text: string): CursorState {
	return parseState(text);
}

/** Build the native playback packet from the daemon's actual, possibly mid-flight hotspot. */
export function cursorMotionCommand(point: Point, state: CursorState, motion: CursorMotionConfig): string {
	const trajectory = planMove(motion, {
		from: state.shown ? state : point,
		to: point,
		reducedMotion: state.reducedMotion,
	});
	return `trajectory ${JSON.stringify({
		style: motion.style,
		arrival: trajectory.arrivalT,
		samples: trajectory.samples.map(({ t, x, y, heading }) => [t, x, y, heading]),
	})}\n`;
}

/** Query and plan on the same connection, so other clients cannot interleave a move. */
export async function prepareCursorMotion(
	socket: Socket,
	command: string,
	motion: CursorMotionConfig,
): Promise<string> {
	const match = /^(pid \d+ )?set (-?\d+) (-?\d+)\n$/.exec(command);
	if (match === null) {
		return command;
	}
	const scope = match[1] ?? "";
	const state = await new Promise<CursorState>((resolve, reject) => {
		let response = "";
		function cleanup(): void {
			socket.off("data", onData);
			socket.off("error", onError);
			socket.off("end", onEnd);
		}
		function onError(error: Error): void {
			cleanup();
			reject(error);
		}
		function onEnd(): void {
			onError(new Error("Cursor overlay closed before returning its state"));
		}
		function onData(chunk: Buffer): void {
			response += chunk.toString("utf8");
			if (response.length > 4096) {
				onError(new Error("Cursor overlay state exceeds 4096 bytes"));
				return;
			}
			const newline = response.indexOf("\n");
			if (newline < 0) {
				return;
			}
			cleanup();
			try {
				resolve(parseState(response.slice(0, newline)));
			} catch (error) {
				reject(error);
			}
		}
		socket.on("data", onData);
		socket.once("error", onError);
		socket.once("end", onEnd);
		socket.write(`${scope}state\n`);
	});
	return `${scope}${cursorMotionCommand({ x: Number(match[2]), y: Number(match[3]) }, state, motion)}`;
}

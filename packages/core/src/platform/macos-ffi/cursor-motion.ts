import type { Socket } from "node:net";
import { planMove } from "../../../vendor/cua-cursor-motion.js";
import type { Point } from "../../types/index.js";
import type { CursorMotionConfig } from "./cursor-motion-config.js";

interface CursorState extends Point {
	readonly shown: boolean;
	readonly reducedMotion: boolean;
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
	return { x: value.x, y: value.y, shown: value.shown, reducedMotion: value.reducedMotion };
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
	const match = /^set (-?\d+) (-?\d+)\n$/.exec(command);
	if (match === null) {
		return command;
	}
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
		socket.write("state\n");
	});
	return cursorMotionCommand({ x: Number(match[1]), y: Number(match[2]) }, state, motion);
}

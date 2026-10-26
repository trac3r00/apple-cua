import { setTimeout as sleep } from "node:timers/promises";
import type { Point, Size } from "../types/index.js";
import { windowsDisplayDiagnostic, windowsDisplayScript } from "./utm-windows-script.js";

type Script = (body: string) => Promise<string>;

function diagnosticStream(value: unknown): { text: string; truncated: boolean } | null {
	if (typeof value !== "string") return null;
	return { text: value.slice(0, 2048), truncated: value.length > 2048 };
}

function guestDiagnostics(raw: object): string {
	const stdout = "outputText" in raw ? raw.outputText : undefined;
	const diagnostics = {
		stdout: diagnosticStream(typeof stdout === "string" ? windowsDisplayDiagnostic(stdout) : stdout),
		stderr: diagnosticStream("errorText" in raw ? raw.errorText : undefined),
	};
	// JSON quoting prevents guest newlines/ANSI from becoming host log structure.
	const quoted = JSON.stringify(diagnostics).replace(
		/[\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/gu,
		(character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
	);
	return `; untrusted guest diagnostics (2048 characters per stream): ${quoted}`;
}

/** Fixed Win32 queries through UTM's guest agent; never operates on the host cursor. */
export async function windowsGuestDisplay(
	script: Script,
	selection: string,
	position?: Point,
	cleanup: Script = script,
): Promise<Size> {
	const command = windowsDisplayScript(position);
	const encoded = Buffer.from(command, "utf16le").toString("base64");
	const processId = Number(
		await script(`${selection}
const p=u.execute(v,{at:"powershell.exe",withArguments:["-NoProfile","-EncodedCommand",${JSON.stringify(encoded)}],outputCapturing:true});
return String(p.id());`),
	);
	if (!Number.isSafeInteger(processId) || processId <= 0) throw new Error("Invalid UTM guest process identifier");
	let running = true;
	try {
		const deadline = Date.now() + 120_000;
		while (Date.now() < deadline) {
			const raw: unknown = JSON.parse(
				await script(`${selection} return JSON.stringify(u.getResult(v.guestProcesses.byId(${processId})));`),
			);
			if (typeof raw !== "object" || raw === null || !("exited" in raw) || typeof raw.exited !== "boolean") {
				throw new Error("Invalid UTM guest process result");
			}
			if (raw.exited) {
				running = false;
				if (
					!("exitCode" in raw) ||
					raw.exitCode !== 0 ||
					!("outputText" in raw) ||
					typeof raw.outputText !== "string"
				) {
					throw new Error(
						`Guest display query failed${position === undefined ? "" : ` for cursor ${position.x},${position.y}`}; guest exit code ${"exitCode" in raw && typeof raw.exitCode === "number" ? raw.exitCode : "unavailable"}${guestDiagnostics(raw)}`,
					);
				}
				const match = /^(\d+)x(\d+)\s*$/u.exec(raw.outputText);
				const width = Number(match?.[1]);
				const height = Number(match?.[2]);
				if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
					throw new Error("Guest returned invalid display dimensions");
				}
				return { width, height };
			}
			await sleep(50);
		}
		throw new Error("Timed out reading the UTM guest display");
	} catch (error) {
		if (running) {
			try {
				const killer = Number(
					await cleanup(`${selection}
return String(u.execute(v,{at:"taskkill.exe",withArguments:["/PID","${processId}","/T","/F"],outputCapturing:true}).id());`),
				);
				if (!Number.isSafeInteger(killer) || killer <= 0)
					throw new Error("Invalid guest cleanup process identifier", { cause: error });
				const deadline = Date.now() + 30_000;
				let terminated = false;
				while (Date.now() < deadline) {
					const raw: unknown = JSON.parse(
						await cleanup(`${selection}
return JSON.stringify(u.getResult(v.guestProcesses.byId(${killer})));`),
					);
					if (typeof raw !== "object" || raw === null || !("exited" in raw) || typeof raw.exited !== "boolean") {
						throw new Error("Invalid guest cleanup result", { cause: error });
					}
					if (raw.exited) {
						if (!("exitCode" in raw) || raw.exitCode !== 0) {
							const original: unknown = JSON.parse(
								await cleanup(`${selection}
return JSON.stringify(u.getResult(v.guestProcesses.byId(${processId})));`),
							);
							if (
								typeof original !== "object" ||
								original === null ||
								!("exited" in original) ||
								original.exited !== true
							)
								throw new Error("Guest query termination failed", { cause: error });
						}
						terminated = true;
						break;
					}
					await sleep(50);
				}
				if (!terminated) throw new Error("Timed out terminating the guest query", { cause: error });
			} catch (cleanupError) {
				throw new Error(
					`Guest query cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
					{ cause: error },
				);
			}
		}
		throw error;
	}
}

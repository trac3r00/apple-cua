import { setTimeout as sleep } from "node:timers/promises";
import type { Point, Size } from "../types/index.js";
import { windowsDisplayScript } from "./utm-windows-script.js";

type Script = (body: string) => Promise<string>;

/** Fixed Win32 queries through UTM's guest agent; never operates on the host cursor. */
export async function windowsGuestDisplay(script: Script, selection: string, position?: Point): Promise<Size> {
	const command = windowsDisplayScript(position);
	const encoded = Buffer.from(command, "utf16le").toString("base64");
	const processId = Number(
		await script(`${selection}
const p=u.execute(v,{at:"powershell.exe",withArguments:["-NoProfile","-EncodedCommand",${JSON.stringify(encoded)}],outputCapturing:true});
return String(p.id());`),
	);
	if (!Number.isSafeInteger(processId) || processId <= 0) throw new Error("Invalid UTM guest process identifier");
	const deadline = Date.now() + 120_000;
	while (Date.now() < deadline) {
		const raw: unknown = JSON.parse(
			await script(`${selection} return JSON.stringify(u.getResult(v.guestProcesses.byId(${processId})));`),
		);
		if (typeof raw !== "object" || raw === null || !("exited" in raw) || typeof raw.exited !== "boolean") {
			throw new Error("Invalid UTM guest process result");
		}
		if (raw.exited) {
			if (
				!("exitCode" in raw) ||
				raw.exitCode !== 0 ||
				!("outputText" in raw) ||
				typeof raw.outputText !== "string"
			) {
				throw new Error("Guest display query failed; Windows and the QEMU guest agent are required");
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
}

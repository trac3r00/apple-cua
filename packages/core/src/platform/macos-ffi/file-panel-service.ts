import type { KoffiFunc } from "koffi";
import { koffi } from "./koffi.js";

/**
 * AppKit's Save and Open panels draw inside the app's window but run in a separate XPC service,
 * one per app, whose "responsible" process is that app. Keyboard events posted to the app never
 * reach the panel's fields, so input for an open panel has to be posted to its service.
 */
const SERVICE_NAME = "com.apple.appkit.xpc.openAndSavePanelService";
const MAX_PIDS = 8192;
const PATH_BUFFER_BYTES = 4096;

const libSystem = koffi.load("/usr/lib/libSystem.B.dylib");
const procListAllPids = libSystem.func(
	"int32_t proc_listallpids(_Out_ int32_t *buffer, int32_t bufferSize)",
) as KoffiFunc<(buffer: Int32Array, bufferSize: number) => number>;
const procPidPath = libSystem.func(
	"int32_t proc_pidpath(int32_t pid, _Out_ uint8_t *buffer, uint32_t size)",
) as KoffiFunc<(pid: number, buffer: Buffer, size: number) => number>;
const responsiblePid = libSystem.func("int32_t responsibility_get_pid_responsible_for_pid(int32_t pid)") as KoffiFunc<
	(pid: number) => number
>;

/** The file panel service working for `appPid`, or undefined when there is none. */
export function filePanelServicePid(appPid: number): number | undefined {
	const pids = new Int32Array(MAX_PIDS);
	const count = procListAllPids(pids, pids.byteLength);
	const path = Buffer.alloc(PATH_BUFFER_BYTES);
	for (let index = 0; index < Math.min(count, MAX_PIDS); index++) {
		const pid = pids[index];
		if (pid === undefined || pid <= 0) {
			continue;
		}
		const length = procPidPath(pid, path, path.byteLength);
		if (length <= 0 || !path.subarray(0, length).toString("utf8").includes(SERVICE_NAME)) {
			continue;
		}
		if (responsiblePid(pid) === appPid) {
			return pid;
		}
	}
	return undefined;
}

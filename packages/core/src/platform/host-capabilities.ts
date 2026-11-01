import type { KoffiFunc } from "koffi";
import { koffi } from "./macos-ffi/koffi.js";
import { isScreenLocked, sessionOnConsole } from "./macos-ffi/lock-screen.js";
import {
	getMainDisplayLogicalSize,
	getMainDisplayNativePixelSize,
	screenCaptureAllowed,
} from "./macos-ffi/screenshot.js";

const applicationServices = koffi.load("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices");
const AXIsProcessTrusted = applicationServices.func("AXIsProcessTrusted", "bool", []) as KoffiFunc<() => boolean>;
const ioKit = koffi.load("/System/Library/Frameworks/IOKit.framework/IOKit");
/** Reads Input Monitoring without asking: 0 granted, 1 denied, 2 not asked yet. */
const IOHIDCheckAccess = ioKit.func("IOHIDCheckAccess", "uint32", ["uint32"]) as KoffiFunc<
	(requestType: number) => number
>;
const IOHID_REQUEST_TYPE_LISTEN_EVENT = 1;
const IOHID_ACCESS_GRANTED = 0;

export interface HostCapabilities {
	readonly permissions: {
		readonly accessibility: boolean;
		/** Screen Recording: required for screenshots; element observation and input work without it. */
		readonly screenRecording: boolean;
		/** Input Monitoring: only the cua-history watcher needs it, to record keystrokes and clicks. */
		readonly inputMonitoring?: boolean;
	};
	readonly session: {
		readonly screenLocked: boolean;
		/** False when this login session is reached through Screen Sharing while another user owns the console. */
		readonly onConsole: boolean | undefined;
	};
	readonly mainDisplay: {
		readonly logical: { readonly width: number; readonly height: number };
		readonly pixels: { readonly width: number; readonly height: number };
	};
}

function guarded<T>(read: () => T, fallback: T): T {
	try {
		return read();
	} catch {
		return fallback;
	}
}

export function probeHostCapabilities(): HostCapabilities {
	return {
		permissions: {
			accessibility: guarded(() => AXIsProcessTrusted(), false),
			screenRecording: guarded(() => screenCaptureAllowed(), false),
			inputMonitoring: guarded(
				() => IOHIDCheckAccess(IOHID_REQUEST_TYPE_LISTEN_EVENT) === IOHID_ACCESS_GRANTED,
				false,
			),
		},
		session: {
			screenLocked: isScreenLocked(),
			onConsole: sessionOnConsole(),
		},
		mainDisplay: {
			logical: guarded(() => getMainDisplayLogicalSize(), { width: 0, height: 0 }),
			pixels: guarded(() => getMainDisplayNativePixelSize(), { width: 0, height: 0 }),
		},
	};
}

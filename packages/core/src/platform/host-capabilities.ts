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

export interface HostCapabilities {
	readonly permissions: {
		readonly accessibility: boolean;
		/** Screen Recording: required for screenshots; element observation and input work without it. */
		readonly screenRecording: boolean;
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

import { measureProcessAudioViaSck } from "./macos-ffi/sckit.js";
import { type OwnedSurfaceOptions, isOwnedSurfacePid, surfaceAudioState } from "./owned-surfaces.js";

export interface SurfaceListening {
	readonly rmsDb: number;
	readonly peakDb: number;
	readonly samples: number;
	readonly durationMs: number;
}

export interface SurfaceListenDependencies {
	readonly measure: (pid: number, durationMs: number) => { rms: number; peak: number; samples: number } | null;
	readonly owned: (pid: number, options: OwnedSurfaceOptions) => boolean;
}

const nativeDependencies: SurfaceListenDependencies = {
	measure: measureProcessAudioViaSck,
	owned: (pid, options) => isOwnedSurfacePid(pid, options),
};

const decibels = (value: number): number => (value > 0 ? Math.max(-160, 20 * Math.log10(value)) : -160);

/**
 * Hears an opencua-owned surface for `durationMs`: the real audio its page plays, media elements included, through a
 * process tap on the WebKit GPU process the surface itself reported. Refused for anything that is not an owned surface
 * or that has not reported its audio process yet; the person's own apps are never listened to.
 */
export function listenToSurface(
	pid: number,
	durationMs: number,
	options: OwnedSurfaceOptions = {},
	dependencies: SurfaceListenDependencies = nativeDependencies,
): SurfaceListening {
	if (!Number.isSafeInteger(durationMs) || durationMs < 50 || durationMs > 10_000) {
		throw new Error("listen duration_ms must be an integer from 50 to 10000");
	}
	if (!dependencies.owned(pid, options)) throw new Error(`pid ${pid} is not an open owned surface`);
	const gpuPid = surfaceAudioState(pid, options)?.gpuPid;
	if (gpuPid === undefined) {
		throw new Error(`surface ${pid} has not reported an audio process yet; it reports one once its page uses audio`);
	}
	const level = dependencies.measure(gpuPid, durationMs);
	if (level === null) throw new Error("the native capture library is unavailable on this host");
	return { rmsDb: decibels(level.rms), peakDb: decibels(level.peak), samples: level.samples, durationMs };
}

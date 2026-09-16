import type { ComputerInterface } from "@macos-cua/core";

/** Tracks the observation backing element ids per app, so an index cannot outlive its tree. */
export class AppObservationKeys {
	private readonly keys = new Map<number, string>();

	record(targetPid: number, observationKey: string | undefined): void {
		if (observationKey === undefined) {
			this.keys.delete(targetPid);
			return;
		}
		this.keys.set(targetPid, observationKey);
	}

	assertCurrent(computer: ComputerInterface, targetPid: number, app: string): void {
		const key = this.keys.get(targetPid);
		if (key === undefined) {
			throw new Error(
				`no observation of ${app} is recorded in this session; call get_app_state before acting on an element index`,
			);
		}
		computer.assertObservationCurrent(targetPid, key);
	}
}

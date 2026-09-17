import type { AppState, AppStateOptions } from "@apple-cua/core";
import { describe, expect, it } from "vitest";
import { GuardedSession } from "./guarded-session.js";
import { jsonPayload } from "./protocol-client-harness.js";
import { Deferred, FakeGuardedComputer } from "./protocol-test-harness.js";

class PausedObservationComputer extends FakeGuardedComputer {
	pauseObservation = false;
	readonly entered = new Deferred<void>();
	readonly release = new Deferred<void>();

	override async getAppState(pid?: number, options?: AppStateOptions): Promise<AppState> {
		if (this.pauseObservation) {
			this.entered.resolve(undefined);
			await this.release.promise;
		}
		return super.getAppState(pid, options);
	}
}

class InconsistentObservationComputer extends FakeGuardedComputer {
	unexpectedState = false;
	override async getAppState(pid?: number, options?: AppStateOptions): Promise<AppState> {
		const state = await super.getAppState(pid, options);
		return this.unexpectedState ? { ...state, pid: 9999, frontmost: false } : state;
	}
}

function requireToken(payload: Record<string, unknown>): string {
	const token = payload["observation_token"];
	if (typeof token !== "string") throw new Error("expected observation token");
	return token;
}

describe("#given a guarded observation #when shutdown or context changes #then no authority leaks", () => {
	it("drains the in-flight post-read before native teardown and does not issue another token", async () => {
		const computer = new PausedObservationComputer();
		const session = new GuardedSession(computer);
		const token = requireToken(jsonPayload(await session.observe({ app: "Finder", diffOnly: false })));
		computer.pauseObservation = true;
		const mutation = session.mutate(
			token,
			"Finder",
			() => undefined,
			async () => computer.type("draft"),
		);
		await computer.entered.promise;
		const closing = session.close();
		const closedBeforeReadFinished = computer.effects.some((effect) => effect.kind === "close");
		computer.release.resolve(undefined);
		const result = jsonPayload(await mutation);
		await closing;

		expect(closedBeforeReadFinished).toBe(false);
		expect(result["observation_token"]).toBeUndefined();
		expect(result["paused"]).toBe(true);
		expect(computer.effects).toEqual([{ kind: "type", text: "draft" }, { kind: "close" }]);
	});

	it("does not authorize a returned state that disagrees with its native observation metadata", async () => {
		const computer = new InconsistentObservationComputer();
		const session = new GuardedSession(computer);
		try {
			const token = requireToken(jsonPayload(await session.observe({ app: "Finder", diffOnly: false })));
			computer.unexpectedState = true;
			const result = jsonPayload(
				await session.mutate(
					token,
					"Finder",
					() => undefined,
					async () => computer.type("draft"),
				),
			);
			expect(result["observation_token"]).toBeUndefined();
			expect(result["paused"]).toBe(true);
			expect(result["observationStatus"]).toBe("context-changed");
		} finally {
			await session.close();
		}
	});
});

import { type MirroringObservation, describeMirroringState } from "@apple-cua/core";
import { InputInterrupted, currentInputScope } from "@apple-cua/core";
import { describe, expect, it } from "vitest";
import { PhoneGuardSession, type PhoneToolSource } from "./phone-session.js";

const ready: MirroringObservation = {
	state: "ready",
	window: { id: 7, x: 100, y: 200, width: 400, height: 600 },
	imageWidth: 800,
	imageHeight: 1200,
	texts: [{ text: "Open", confidence: 0.99, x: 120, y: 240, width: 80, height: 40 }],
};

function source(
	initial: MirroringObservation = ready,
): PhoneToolSource & { calls: { x: number; y: number }[]; current: MirroringObservation } {
	const value = {
		current: initial,
		calls: [] as { x: number; y: number }[],
		observe: async () => value.current,
		screenshot: async () => Buffer.from("png"),
		tap: async (x: number, y: number) => {
			value.calls.push({ x, y });
		},
		longPress: async () => {},
		swipe: async () => {},
		scroll: async () => {},
		typeText: async () => {},
		pressKeys: async () => {},
		home: async () => {},
		appSwitcher: async () => {},
		openApp: async () => {},
	};
	return value;
}

function payload(result: { content: { type: string; text?: string }[] }): Record<string, unknown> {
	const item = result.content.find((entry) => entry.type === "text");
	return JSON.parse(item?.text ?? "{}");
}

function tokenFrom(result: Awaited<ReturnType<PhoneGuardSession["observe"]>>): string {
	const token = payload(result)["observation_token"];
	if (typeof token !== "string") throw new Error("expected an observation token");
	return token;
}

function signal(): { readonly promise: Promise<void>; readonly resolve: () => void } {
	let resolve: () => void = () => {
		throw new Error("signal was not initialized");
	};
	const promise = new Promise<void>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

describe("guarded iPhone Mirroring protocol", () => {
	it("#given a stop during native tap readiness #when readiness completes #then no press is dispatched", async () => {
		let stopped = false;
		const phone = source();
		const guard = new PhoneGuardSession(phone, {
			stopSwitch: {
				status: () =>
					stopped
						? { stopped: true, stoppedAt: "2026-10-07T00:00:00Z", reason: "test", source: "chord" }
						: { stopped: false },
			},
		});
		const token = tokenFrom(await guard.observe());
		const entered = signal();
		const release = signal();
		phone.tap = async (x, y) => {
			entered.resolve();
			await release.promise;
			const interruption = currentInputScope()?.interruption?.();
			if (interruption !== undefined) throw new InputInterrupted(interruption);
			phone.calls.push({ x, y });
		};

		const tapping = guard.consume(token, {}, async () => phone.tap(150, 250));
		await entered.promise;
		stopped = true;
		release.resolve();
		const result = payload(await tapping);

		expect(phone.calls).toHaveLength(0);
		expect(result["reason"]).toBe("user-stopped");
		expect(result["observation_token"]).toBeUndefined();
	});

	it.each([
		{ x: 500, y: 250 },
		{ x: 150, y: 800 },
	])("#given a point on the excluded right or bottom edge #when tapping #then refuses $x,$y", async (point) => {
		const phone = source();
		const guard = new PhoneGuardSession(phone);
		const token = tokenFrom(await guard.observe());

		const result = await guard.consume(token, point, async () => phone.tap(point.x, point.y));

		expect(payload(result)["reason"]).toBe("phone-coordinate-outside-window");
		expect(phone.calls).toHaveLength(0);
	});

	it("#given a completed tap and failed readback #when reporting #then never claims no input was dispatched", async () => {
		const phone = source();
		const guard = new PhoneGuardSession(phone);
		const token = tokenFrom(await guard.observe());
		phone.observe = async () => {
			if (phone.calls.length > 0) throw new Error("capture failed after input");
			return phone.current;
		};

		const result = payload(await guard.consume(token, {}, async () => phone.tap(150, 250)));

		expect(result["actionDispatched"]).toBe(true);
		expect(result["effect"]).toBe("unverifiable");
		expect(result["observation_token"]).toBeUndefined();
		expect(phone.calls).toHaveLength(1);
	});

	it("#given a blocked session after a tap #when reporting #then preserves the dispatched input evidence", async () => {
		const phone = source();
		const guard = new PhoneGuardSession(phone);
		const token = tokenFrom(await guard.observe());

		const result = payload(
			await guard.consume(token, {}, async () => {
				await phone.tap(150, 250);
				phone.current = { ...ready, state: "blocked" };
			}),
		);

		expect(result["reason"]).toBe("phone-not-ready");
		expect(result["actionDispatched"]).toBe(true);
		expect(result["observation_token"]).toBeUndefined();
	});

	it("issues one-use tokens and returns a continuation after a tap", async () => {
		const phone = source();
		const guard = new PhoneGuardSession(phone);
		const observation = payload(await guard.observe());
		const token = observation["observation_token"] as string;
		const result = payload(await guard.consume(token, { x: 150, y: 250 }, async () => phone.tap(150, 250)));
		expect(phone.calls).toEqual([{ x: 150, y: 250 }]);
		expect(result["observation_token"]).toEqual(expect.any(String));
		expect(result["observation_token"]).not.toBe(token);
	});

	it("refuses missing, reused, expired, and out-of-window tokens", async () => {
		let now = 0;
		const phone = source();
		const guard = new PhoneGuardSession(phone, { now: () => now, ttlMs: 100 });
		expect((await guard.consume(undefined, {}, async () => {})).isError).toBe(true);
		const token = payload(await guard.observe())["observation_token"] as string;
		expect((await guard.consume(token, { x: 99, y: 250 }, async () => {})).isError).toBe(true);
		now = 101;
		expect((await guard.consume(token, { x: 150, y: 250 }, async () => {})).isError).toBe(true);
	});

	it("refuses a second use of a token that is still inside its lifetime", async () => {
		const phone = source();
		const guard = new PhoneGuardSession(phone, { now: () => 0, ttlMs: 100 });
		const token = payload(await guard.observe())["observation_token"] as string;
		expect((await guard.consume(token, { x: 150, y: 250 }, async () => phone.tap(150, 250))).isError).toBeFalsy();
		const reused = payload(await guard.consume(token, { x: 150, y: 250 }, async () => phone.tap(150, 250)));
		expect(reused["reason"]).toBe("phone-token-consumed");
		expect(phone.calls).toHaveLength(1);
	});

	it("uses the centre of matching text and reports visible text on failure", async () => {
		const phone = source();
		const guard = new PhoneGuardSession(phone);
		const token = payload(await guard.observe())["observation_token"] as string;
		const match = ready.texts[0];
		if (match === undefined) {
			throw new Error("the fixture text is missing");
		}
		await guard.consume(token, {}, async (observation) => {
			const hit = observation.texts.find((text) => text.text === "Open");
			if (hit === undefined) throw new Error("not found");
			await phone.tap(hit.x + hit.width / 2, hit.y + hit.height / 2);
		});
		expect(phone.calls).toEqual([{ x: match.x + match.width / 2, y: match.y + match.height / 2 }]);
		const blocked = source({ ...ready, state: "blocked" });
		const refusal = await new PhoneGuardSession(blocked).observe();
		expect(payload(refusal)["message"]).toContain(describeMirroringState("blocked"));
	});

	it("#given concurrent token reuse #when preflight is suspended #then only one mutation runs", async () => {
		const phone = source();
		const guard = new PhoneGuardSession(phone);
		const token = tokenFrom(await guard.observe());
		const entered = signal();
		const release = signal();
		phone.observe = async () => {
			entered.resolve();
			await release.promise;
			return phone.current;
		};

		const first = guard.consume(token, {}, async () => phone.tap(150, 250));
		await entered.promise;
		const second = guard.consume(token, {}, async () => phone.tap(150, 250));
		release.resolve();
		const results = await Promise.all([first, second]);

		expect(phone.calls).toHaveLength(1);
		expect(results.filter((result) => result.isError === true)).toHaveLength(1);
	});

	it("#given a newer observation #when older authority is used #then no input is dispatched", async () => {
		const phone = source();
		const guard = new PhoneGuardSession(phone);
		const oldToken = tokenFrom(await guard.observe());
		await guard.observe();

		const result = await guard.consume(oldToken, {}, async () => phone.tap(150, 250));

		expect(result.isError).toBe(true);
		expect(phone.calls).toHaveLength(0);
	});

	it.each(["x", "y", "width", "height"] as const)(
		"#given changed window %s #when old coordinates are used #then no input is dispatched",
		async (dimension) => {
			const phone = source();
			const guard = new PhoneGuardSession(phone);
			const token = tokenFrom(await guard.observe());
			phone.current = {
				...ready,
				window: { ...ready.window, [dimension]: ready.window[dimension] + 10 },
			};

			const result = await guard.consume(token, { x: 150, y: 250 }, async () => phone.tap(150, 250));

			expect(payload(result)["reason"]).toBe("phone-window-changed");
			expect(phone.calls).toHaveLength(0);
		},
	);

	it("#given a stop during preflight #when the observation completes #then input is refused", async () => {
		let stopped = false;
		const phone = source();
		const guard = new PhoneGuardSession(phone, {
			stopSwitch: {
				status: () =>
					stopped
						? { stopped: true, stoppedAt: "2026-10-07T00:00:00Z", reason: "test", source: "chord" }
						: { stopped: false },
			},
		});
		const token = tokenFrom(await guard.observe());
		phone.observe = async () => {
			stopped = true;
			return phone.current;
		};

		const result = await guard.consume(token, {}, async () => phone.tap(150, 250));

		expect(payload(result)["reason"]).toBe("user-stopped");
		expect(phone.calls).toHaveLength(0);
	});
});

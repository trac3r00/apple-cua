import { type MirroringObservation, describeMirroringState } from "@apple-cua/core";
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

describe("guarded iPhone Mirroring protocol", () => {
	it("issues one-use tokens and returns a continuation after a tap", async () => {
		const phone = source();
		const guard = new PhoneGuardSession(phone);
		const observation = payload(await guard.observe());
		const token = observation.observation_token as string;
		const result = payload(await guard.consume(token, { x: 150, y: 250 }, async () => phone.tap(150, 250)));
		expect(phone.calls).toEqual([{ x: 150, y: 250 }]);
		expect(result.observation_token).toEqual(expect.any(String));
		expect(result.observation_token).not.toBe(token);
	});

	it("refuses missing, reused, expired, and out-of-window tokens", async () => {
		let now = 0;
		const phone = source();
		const guard = new PhoneGuardSession(phone, { now: () => now, ttlMs: 100 });
		expect((await guard.consume(undefined, {}, async () => {})).isError).toBe(true);
		const token = payload(await guard.observe()).observation_token as string;
		expect((await guard.consume(token, { x: 99, y: 250 }, async () => {})).isError).toBe(true);
		now = 101;
		expect((await guard.consume(token, { x: 150, y: 250 }, async () => {})).isError).toBe(true);
	});

	it("refuses a second use of a token that is still inside its lifetime", async () => {
		const phone = source();
		const guard = new PhoneGuardSession(phone, { now: () => 0, ttlMs: 100 });
		const token = payload(await guard.observe()).observation_token as string;
		expect((await guard.consume(token, { x: 150, y: 250 }, async () => phone.tap(150, 250))).isError).toBeFalsy();
		const reused = payload(await guard.consume(token, { x: 150, y: 250 }, async () => phone.tap(150, 250)));
		expect(reused.reason).toBe("phone-token-consumed");
		expect(phone.calls).toHaveLength(1);
	});

	it("uses the centre of matching text and reports visible text on failure", async () => {
		const phone = source();
		const guard = new PhoneGuardSession(phone);
		const token = payload(await guard.observe()).observation_token as string;
		const match = ready.texts[0];
		await guard.consume(token, {}, async (observation) => {
			const hit = observation.texts.find((text) => text.text === "Open");
			if (hit === undefined) throw new Error("not found");
			await phone.tap(hit.x + hit.width / 2, hit.y + hit.height / 2);
		});
		expect(phone.calls).toEqual([{ x: match.x + match.width / 2, y: match.y + match.height / 2 }]);
		const blocked = source({ ...ready, state: "blocked" });
		const refusal = await new PhoneGuardSession(blocked).observe();
		expect(payload(refusal).message).toContain(describeMirroringState("blocked"));
	});
});

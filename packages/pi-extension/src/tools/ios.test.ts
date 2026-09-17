import { describe, expect, it, vi } from "vitest";

const phone = vi.hoisted(() => ({
	observe: vi.fn(),
	tap: vi.fn(),
	longPress: vi.fn(),
}));

vi.mock("@apple-cua/core", () => ({
	IPhoneMirroring: vi.fn(() => phone),
	findTexts: (texts: readonly { text: string }[], query: string, exact: boolean) =>
		texts.filter((text) => (exact ? text.text === query : text.text.includes(query))),
	requireMirroringSession: vi.fn().mockResolvedValue({ window: { id: 7 } }),
}));

import { createIosObserveTool } from "./ios-observe.js";
import { PhoneObservationKeys } from "./ios-shared.js";
import { createIosTapTextTool } from "./ios-tap-text.js";
import { createIosTapTool } from "./ios-tap.js";

type Text = { text: string; confidence: number; x: number; y: number; width: number; height: number };
const observation = () => ({
	state: "ready" as const,
	window: { id: 7, x: 0, y: 0, width: 200, height: 400 },
	imageWidth: 200,
	imageHeight: 400,
	texts: [{ text: "Settings", confidence: 0.99, x: 10, y: 20, width: 80, height: 20 } satisfies Text],
});

async function observe(keys: PhoneObservationKeys): Promise<void> {
	phone.observe.mockResolvedValueOnce(observation());
	await createIosObserveTool(keys).execute("observe", {}, undefined, undefined, {} as never);
}

describe("iOS pi tools", () => {
	it("observe lists visible texts with tap-ready centres", async () => {
		const keys = new PhoneObservationKeys();
		phone.observe.mockResolvedValue(observation());
		const result = await createIosObserveTool(keys).execute("observe", {}, undefined, undefined, {} as never);
		expect(result.content[0]).toMatchObject({ type: "text" });
		const payload = JSON.parse((result.content[0] as { text: string }).text) as {
			readonly texts: readonly {
				readonly text: string;
				readonly centre: { readonly x: number; readonly y: number };
			}[];
		};
		expect(payload.texts[0]).toMatchObject({ text: "Settings", centre: { x: 50, y: 30 } });
	});

	it("refuses mutation without a prior observation", async () => {
		await expect(
			createIosTapTool(new PhoneObservationKeys()).execute("tap", { x: 1, y: 2 }, undefined, undefined, {} as never),
		).rejects.toThrow("call ios_observe");
		expect(phone.tap).not.toHaveBeenCalled();
	});

	it("dispatches mutation after observation", async () => {
		const keys = new PhoneObservationKeys();
		await observe(keys);
		await createIosTapTool(keys).execute("tap", { x: 4, y: 5 }, undefined, undefined, {} as never);
		expect(phone.tap).toHaveBeenCalledWith(4, 5);
	});

	it("tap_text taps the matching box centre", async () => {
		const keys = new PhoneObservationKeys();
		await observe(keys);
		phone.observe.mockResolvedValueOnce(observation());
		await createIosTapTextTool(keys).execute("tap-text", { query: "Settings" }, undefined, undefined, {} as never);
		expect(phone.tap).toHaveBeenCalledWith(50, 30);
	});
});

import type { MirroringObservation, StopStatus } from "@apple-cua/core";
import { InputInterrupted, currentInputScope } from "@apple-cua/core";
import { afterEach, describe, expect, it } from "vitest";
import { iosFindTextSchema } from "./phone-search.js";
import { PhoneGuardSession, type PhoneToolSource } from "./phone-session.js";
import { createHarness, jsonPayload } from "./protocol-client-harness.js";

class PagedPhone implements PhoneToolSource {
	page = 0;
	window = { id: 7, x: 100, y: 200, width: 400, height: 600 };
	state: MirroringObservation["state"] = "ready";
	readonly taps: { readonly x: number; readonly y: number }[] = [];
	readonly scrolls: {
		readonly direction: Parameters<PhoneToolSource["scroll"]>[0];
		readonly options: Parameters<PhoneToolSource["scroll"]>[1];
	}[] = [];
	onScroll: (() => void) | undefined;
	onObserve: (() => void) | undefined;
	beforeScroll: (() => Promise<void>) | undefined;

	constructor(readonly pages: readonly string[]) {}

	async observe(): Promise<MirroringObservation> {
		this.onObserve?.();
		return {
			state: this.state,
			window: this.window,
			imageWidth: 800,
			imageHeight: 1200,
			texts: [{ text: this.pages[this.page] ?? "", confidence: 1, x: 120, y: 240, width: 80, height: 40 }],
		};
	}

	async scroll(
		direction: Parameters<PhoneToolSource["scroll"]>[0],
		options: Parameters<PhoneToolSource["scroll"]>[1] = {},
	): Promise<void> {
		if (options.borrowPointer !== true) throw new Error("background scroll requires explicit pointer borrowing");
		await this.beforeScroll?.();
		const interruption = currentInputScope()?.interruption?.();
		if (interruption !== undefined) throw new InputInterrupted(interruption);
		this.scrolls.push({ direction, options });
		this.page = Math.min(this.page + 1, this.pages.length - 1);
		this.onScroll?.();
	}

	async tap(x: number, y: number): Promise<void> {
		this.taps.push({ x, y });
	}
	async screenshot(): Promise<Buffer> {
		return Buffer.from("png");
	}
	async longPress(): Promise<void> {}
	async swipe(): Promise<void> {}
	async typeText(): Promise<void> {}
	async pressKeys(): Promise<void> {}
	async home(): Promise<void> {}
	async appSwitcher(): Promise<void> {}
	async openApp(): Promise<void> {}
}

let closeHarness: (() => Promise<void>) | undefined;
afterEach(async () => {
	await closeHarness?.();
	closeHarness = undefined;
});

async function start(phone: PagedPhone, status: () => StopStatus = () => ({ stopped: false })) {
	const harness = await createHarness(undefined, undefined, undefined, {
		phoneSource: phone,
		stopSwitch: { status },
		serverOptions: { iphone: true },
	});
	closeHarness = harness.close;
	const initial = jsonPayload(await harness.client.callTool({ name: "ios_observe", arguments: {} }));
	const token = initial["observation_token"];
	if (typeof token !== "string") throw new Error("phone observation did not issue a token");
	return {
		harness,
		find: async (arguments_: Record<string, unknown>) =>
			jsonPayload(
				await harness.client.callTool({
					name: "ios_find_text",
					arguments: { observation_token: token, ...arguments_ },
				}),
			),
	};
}

describe("iOS autonomous text search", () => {
	it("#given a stop during native readiness #when scrolling resumes #then no wheel input is dispatched", async () => {
		let stopped = false;
		let entered: () => void = () => {
			throw new Error("readiness signal not initialized");
		};
		let release: () => void = () => {
			throw new Error("release signal not initialized");
		};
		const readiness = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const released = new Promise<void>((resolve) => {
			release = resolve;
		});
		const phone = new PagedPhone(["First", "Target"]);
		const setup = await start(phone, () =>
			stopped
				? { stopped: true, stoppedAt: "2026-10-07T00:00:00Z", reason: "test", source: "chord" }
				: { stopped: false },
		);
		phone.beforeScroll = async () => {
			entered();
			await released;
		};

		const search = setup.find({ query: "Target", borrow_pointer: true });
		await readiness;
		stopped = true;
		release();
		const result = await search;

		expect(phone.scrolls).toHaveLength(0);
		expect(result["reason"]).toBe("user-stopped");
		expect(result["observation_token"]).toBeUndefined();
	});

	it("#given a target appearing during preflight #when finding it #then never scrolls past it", async () => {
		const phone = new PagedPhone(["First", "Target", "After"]);
		const setup = await start(phone);
		let reads = 0;
		phone.onObserve = () => {
			reads += 1;
			if (reads === 2) phone.page = 1;
		};

		const result = await setup.find({ query: "Target", borrow_pointer: true });

		expect(result["search"]).toMatchObject({ found: true, scrolls: 0 });
		expect(phone.scrolls).toHaveLength(0);
	});

	it("#given a budget expiring during preflight #when searching #then starts no late scroll", async () => {
		let now = 0;
		const phone = new PagedPhone(["First", "Target"]);
		const guard = new PhoneGuardSession(phone, { now: () => now });
		const initial = jsonPayload(await guard.observe());
		let reads = 0;
		phone.onObserve = () => {
			reads += 1;
			if (reads === 2) now = 20;
		};
		const input = iosFindTextSchema.parse({
			observation_token: initial["observation_token"],
			query: "Target",
			borrow_pointer: true,
			timeout_ms: 10,
		});

		const result = jsonPayload(await guard.findText(input));

		expect(result["search"]).toMatchObject({ found: false, reason: "timeout", scrolls: 0 });
		expect(phone.scrolls).toHaveLength(0);
	});

	it("#given a visible target #when finding text #then confirms it without scrolling or tapping", async () => {
		const phone = new PagedPhone(["Settings"]);
		const setup = await start(phone);

		const result = await setup.find({ query: "Settings", exact: true });

		expect(result["search"]).toMatchObject({ found: true, reason: "matched", scrolls: 0 });
		expect(result["verification"]).toMatchObject({ verified: true, query: "Settings" });
		expect(result["actionDispatched"]).toBe(false);
		expect(result["observation_token"]).toEqual(expect.any(String));
		expect(phone.scrolls).toHaveLength(0);
		expect(phone.taps).toHaveLength(0);
	});

	it("#given an offscreen target #when finding text #then pages autonomously and never taps", async () => {
		const phone = new PagedPhone(["First", "Second", "Privacy"]);
		const setup = await start(phone);

		const result = await setup.find({ query: "Privacy", borrow_pointer: true, direction: "down", amount: 0.4 });

		expect(result["search"]).toMatchObject({
			found: true,
			scrolls: 2,
			matches: [{ text: "Privacy", center: { x: 160, y: 260 } }],
		});
		expect(phone.scrolls).toEqual([
			{ direction: "down", options: { amount: 0.4, borrowPointer: true } },
			{ direction: "down", options: { amount: 0.4, borrowPointer: true } },
		]);
		expect(phone.taps).toHaveLength(0);
	});

	it("#given a finite page budget #when the target is absent #then stops at the budget", async () => {
		const phone = new PagedPhone(["First", "Second", "Third"]);
		const setup = await start(phone);

		const result = await setup.find({ query: "Missing", borrow_pointer: true, max_scrolls: 1 });

		expect(result["search"]).toMatchObject({ found: false, reason: "max_scrolls", scrolls: 1 });
		expect(result["verification"]).toMatchObject({ verified: false });
		expect(phone.scrolls).toHaveLength(1);
		expect(phone.taps).toHaveLength(0);
	});

	it("#given unchanged content #when searching further #then reports no progress without exhausting the budget", async () => {
		const phone = new PagedPhone(["Static"]);
		const setup = await start(phone);

		const result = await setup.find({ query: "Missing", borrow_pointer: true, max_scrolls: 20 });

		expect(result["search"]).toMatchObject({ found: false, reason: "no_progress", scrolls: 2 });
		expect(phone.scrolls).toHaveLength(2);
	});

	it("#given no pointer borrowing #when an offscreen search needs a scroll #then preserves the source refusal", async () => {
		const phone = new PagedPhone(["First", "Target"]);
		const setup = await start(phone);

		const result = await setup.find({ query: "Target" });

		expect(result["paused"]).toBe(true);
		expect(result["observation_token"]).toBeUndefined();
		expect(phone.scrolls).toHaveLength(0);
		expect(phone.taps).toHaveLength(0);
	});

	it("#given a stop during a page #when searching #then reports partial progress and sends no later input", async () => {
		let stopped = false;
		const phone = new PagedPhone(["First", "Second", "Target"]);
		const setup = await start(phone, () =>
			stopped
				? { stopped: true, stoppedAt: "2026-10-07T00:00:00Z", reason: "test", source: "chord" }
				: { stopped: false },
		);
		phone.onScroll = () => {
			stopped = true;
		};

		const result = await setup.find({ query: "Target", borrow_pointer: true });

		expect(result["reason"]).toBe("user-stopped");
		expect(result["actionDispatched"]).toBe(true);
		expect(result["effect"]).toBe("partial");
		expect(result["observation_token"]).toBeUndefined();
		expect(phone.scrolls).toHaveLength(1);
	});

	it("#given a moved phone window #when finding offscreen text #then refuses stale coordinates", async () => {
		const phone = new PagedPhone(["First", "Target"]);
		const setup = await start(phone);
		phone.window = { ...phone.window, x: 130 };

		const result = await setup.find({ query: "Target", borrow_pointer: true });

		expect(result["reason"]).toBe("phone-window-changed");
		expect(phone.scrolls).toHaveLength(0);
	});

	it("#given malformed search input #when calling the tool #then rejects before any scroll", async () => {
		const phone = new PagedPhone(["First", "Target"]);
		const setup = await start(phone);

		for (const arguments_ of [{ query: " " }, { query: "Target", max_scrolls: 1000 }]) {
			const result = await setup.harness.client.callTool({
				name: "ios_find_text",
				arguments: { observation_token: "unused", ...arguments_ },
			});
			expect(result.isError).toBe(true);
		}
		expect(phone.scrolls).toHaveLength(0);
	});
});

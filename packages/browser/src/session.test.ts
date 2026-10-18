import { describe, expect, it } from "vitest";
import type { BrowserTransport } from "./bridge.js";
import { type BrowserCommand, BrowserError, limitsSchema, stepSchema } from "./protocol.js";
import { BrowserSession } from "./session.js";

const observation = (revision: string, rows = [{ ref: 1, role: "button", name: "Continue" }]) => ({
	url: "https://example.com",
	title: "Example",
	revision,
	rows,
	truncated: false,
});

class MemoryTransport implements BrowserTransport {
	generation = 1;
	readonly commands: BrowserCommand[] = [];
	response: unknown = { tabId: 7 };
	pending: { resolve: (value: unknown) => void; reject: (reason: unknown) => void } | undefined;

	request(command: BrowserCommand): Promise<unknown> {
		this.commands.push(command);
		if (this.pending !== undefined) {
			return new Promise((resolve, reject) => {
				this.pending = { resolve, reject };
			});
		}
		if (this.response === undefined) {
			return new Promise((resolve, reject) => {
				this.pending = { resolve, reject };
			});
		}
		return Promise.resolve(this.response);
	}

	resolve(value: unknown): void {
		this.pending?.resolve(value);
		this.pending = undefined;
	}

	reject(reason: unknown): void {
		this.pending?.reject(reason);
		this.pending = undefined;
	}
}

describe("BrowserSession", () => {
	it("#given a first observation #when observing unchanged then changed rows #then returns full then delta", async () => {
		const transport = new MemoryTransport();
		const session = new BrowserSession(transport);
		await session.open("https://example.com");
		transport.response = observation("document:1");
		expect((await session.observe(7)).format).toBe("full");
		expect(await session.observe(7)).toMatchObject({ format: "delta", changed: [], removed: [] });
		transport.response = observation("document:2", [{ ref: 2, role: "link", name: "More" }]);
		const delta = await session.observe(7);
		expect(delta).toMatchObject({ format: "delta", changed: [{ ref: 2, role: "link", name: "More" }], removed: [1] });
	});

	it("#given a reloaded document at the same URL #when numeric refs repeat #then returns full rows", async () => {
		const transport = new MemoryTransport();
		const session = new BrowserSession(transport);
		await session.open("https://example.com");
		transport.response = observation("first:0");
		await session.observe(7);
		transport.response = observation("second:0");
		expect(await session.observe(7)).toMatchObject({
			format: "full",
			rows: [{ ref: 1, role: "button", name: "Continue" }],
		});
	});

	it("#given an in-flight open #when cancelled #then retains ownership of the created tab", async () => {
		const transport = new MemoryTransport();
		const session = new BrowserSession(transport);
		const cancellation = new AbortController();
		transport.response = undefined;
		const opening = session.open("https://example.com", cancellation.signal);
		cancellation.abort();
		transport.response = {};
		transport.resolve({ tabId: 7 });
		await expect(opening).resolves.toEqual({ tabId: 7 });
		await session.close(7);
		expect(transport.commands).toEqual([
			{ method: "open", url: "https://example.com" },
			{ method: "close", tabId: 7 },
		]);
		await expect(session.observe(7)).rejects.toMatchObject({ code: "stale" });
	});

	it("#given an observation token #when used twice #then refuses the consumed token", async () => {
		const transport = new MemoryTransport();
		const session = new BrowserSession(transport);
		await session.open("https://example.com");
		transport.response = observation("r1");
		const first = await session.observe(7);
		transport.response = { observation: observation("r2"), verified: true, completedSteps: 1 };
		await session.run(7, first.observation_token, [{ action: "click", ref: 1 }], undefined);
		await expect(
			session.run(7, first.observation_token, [{ action: "click", ref: 1 }], undefined),
		).rejects.toMatchObject({ code: "stale" });
	});

	it("#given an extension reconnect #when using old tab ownership #then rejects the generation", async () => {
		const transport = new MemoryTransport();
		const session = new BrowserSession(transport);
		await session.open("https://example.com");
		transport.generation++;
		await expect(session.observe(7)).rejects.toMatchObject({ code: "stale" });
	});

	it("#given an active observation #when another command overlaps #then rejects as busy", async () => {
		const transport = new MemoryTransport();
		const session = new BrowserSession(transport);
		await session.open("https://example.com");
		transport.response = undefined;
		const pending = session.observe(7);
		await expect(session.observe(7)).rejects.toMatchObject({ code: "busy" });
		transport.resolve(observation("r1"));
		await expect(pending).resolves.toMatchObject({ format: "full" });
	});

	it.each(["resolve", "reject"] as const)(
		"#given an active close that will %s #when commands overlap #then holds busy until settlement",
		async (outcome) => {
			const transport = new MemoryTransport();
			const session = new BrowserSession(transport);
			await session.open("https://example.com");
			transport.response = undefined;
			const closing = session.close(7);
			const settled = expect(closing);
			await expect(session.observe(7)).rejects.toMatchObject({ code: "busy" });
			await expect(session.close(7)).rejects.toMatchObject({ code: "busy" });
			if (outcome === "resolve") {
				transport.resolve({});
				await settled.resolves.toBeUndefined();
				await expect(session.observe(7)).rejects.toMatchObject({ code: "stale" });
			} else {
				transport.reject(new BrowserError("extension", "close failed"));
				await settled.rejects.toMatchObject({ code: "extension" });
				transport.response = observation("document:0");
				await expect(session.observe(7)).resolves.toMatchObject({ format: "full" });
			}
		},
	);

	it("#given a mutation token #when its request fails #then consumes the token", async () => {
		const transport = new MemoryTransport();
		const session = new BrowserSession(transport);
		await session.open("https://example.com");
		transport.response = observation("r1");
		const first = await session.observe(7);
		transport.response = undefined;
		const failedRun = session.run(7, first.observation_token, [{ action: "click", ref: 1 }], undefined);
		transport.reject(new BrowserError("disconnected", "gone"));
		await expect(failedRun).rejects.toMatchObject({ code: "disconnected" });
		await expect(
			session.run(7, first.observation_token, [{ action: "click", ref: 1 }], undefined),
		).rejects.toMatchObject({ code: "stale" });
	});

	it("#given an unowned tab #when observing or closing #then rejects without transport", async () => {
		const transport = new MemoryTransport();
		const session = new BrowserSession(transport);
		await expect(session.observe(99)).rejects.toMatchObject({ code: "stale" });
		await expect(session.close(99)).rejects.toMatchObject({ code: "stale" });
		expect(transport.commands).toEqual([]);
	});

	it("#given limits and steps #when validating protocol schemas #then enforces declared bounds", () => {
		expect(limitsSchema.safeParse({ maxChars: 255, maxElements: 1, fullPage: false }).success).toBe(false);
		expect(limitsSchema.safeParse({ maxChars: 256, maxElements: 1, fullPage: false }).success).toBe(true);
		expect(limitsSchema.safeParse({ maxChars: 20000, maxElements: 200, fullPage: true }).success).toBe(true);
		expect(limitsSchema.safeParse({ maxChars: 20001, maxElements: 1, fullPage: false }).success).toBe(false);
		expect(limitsSchema.safeParse({ maxChars: 6000, maxElements: 0, fullPage: false }).success).toBe(false);
		expect(limitsSchema.safeParse({ maxChars: 6000, maxElements: 201, fullPage: false }).success).toBe(false);
	});

	it.each([
		[{ action: "click", ref: 1 }, true],
		[{ action: "click", ref: 0 }, false],
		[{ action: "click", ref: -1 }, false],
		[{ action: "click", ref: 1.5 }, false],
		[{ action: "fill", ref: 1, text: "" }, true],
		[{ action: "fill", ref: 1, text: "x".repeat(10000) }, true],
		[{ action: "fill", ref: 1, text: "x".repeat(10001) }, false],
		[{ action: "fill", ref: 0, text: "text" }, false],
		[{ action: "press", ref: 1, key: "Enter" }, true],
		[{ action: "press", ref: 1, key: "Tab" }, true],
		[{ action: "press", ref: 1, key: "Escape" }, true],
		[{ action: "press", ref: 1, key: "ArrowDown" }, true],
		[{ action: "press", ref: 1, key: "ArrowUp" }, true],
		[{ action: "press", ref: 1, key: "Delete" }, false],
		[{ action: "press", ref: 0, key: "Enter" }, false],
		[{ action: "scroll", deltaY: -5000 }, true],
		[{ action: "scroll", deltaY: 5000 }, true],
		[{ action: "scroll", deltaY: -5001 }, false],
		[{ action: "scroll", deltaY: 5001 }, false],
		[{ action: "scroll", deltaY: Number.POSITIVE_INFINITY }, false],
		[{ action: "scroll", deltaY: Number.NaN }, false],
		[{ action: "unknown", ref: 1 }, false],
	] as const)("#given step boundary case %# #when parsing #then validates its declared bounds", (step, valid) => {
		expect(stepSchema.safeParse(step).success).toBe(valid);
	});
});

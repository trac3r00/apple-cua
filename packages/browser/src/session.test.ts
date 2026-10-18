import { describe, expect, it } from "vitest";
import type { BrowserTransport } from "./bridge.js";
import { type BrowserCommand, BrowserError, limitsSchema } from "./protocol.js";
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
		transport.response = observation("r1");
		expect((await session.observe(7)).format).toBe("full");
		transport.response = observation("r2", [{ ref: 2, role: "link", name: "More" }]);
		const delta = await session.observe(7);
		expect(delta).toMatchObject({ format: "delta", changed: [{ ref: 2, role: "link", name: "More" }], removed: [1] });
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
		expect(limitsSchema.safeParse({ maxChars: 20000, maxElements: 200, fullPage: true }).success).toBe(true);
		expect(limitsSchema.safeParse({ maxChars: 20001, maxElements: 201, fullPage: false }).success).toBe(false);
	});
});

import type { Rect } from "@macos-cua/core";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, jsonPayload, jsonText, observe } from "./protocol-client-harness.js";
import { FakeGuardedComputer } from "./protocol-test-harness.js";

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	if (closeHarness !== undefined) {
		await closeHarness();
		closeHarness = undefined;
	}
});

describe("invoke_menu #given an observed target app #when a native path resolves #then dispatch is guard-bound", () => {
	it("uses the token pid and returns the resolved path", async () => {
		const computer = Object.assign(new FakeGuardedComputer(), {
			invokeMenu: async (pid: number, path: readonly string[]) => ({
				resolvedPath: [...path],
				action: `AXPress:${pid}`,
			}),
		});
		const harness = await createHarness(computer);
		closeHarness = harness.close;
		const token = await observe(harness);

		const result = await harness.client.callTool({
			name: "invoke_menu",
			arguments: { app: "Finder", observation_token: token, path: ["File", "Open"] },
		});

		expect(result.isError).not.toBe(true);
		expect(jsonPayload(result)["invokeMenu"]).toEqual({
			resolvedPath: ["File", "Open"],
			action: "AXPress:1234",
		});
		expect(computer.preflightExpected).toHaveLength(1);
	});

	it("surfaces an ambiguity refusal from the live resolver", async () => {
		const computer = Object.assign(new FakeGuardedComputer(), {
			invokeMenu: async () => {
				throw new Error('invoke_menu: path segment 1 ("Open") is ambiguous; failed at hop 1');
			},
		});
		const harness = await createHarness(computer);
		closeHarness = harness.close;
		const token = await observe(harness);

		const result = await harness.client.callTool({
			name: "invoke_menu",
			arguments: { app: "Finder", observation_token: token, path: ["File", "Open"] },
		});

		expect(result.isError).toBe(true);
		expect(jsonText(result)).toContain("failed at hop 1");
	});
});

describe("set_window_frame #given an observed top-level window #when native read-back differs #then applied geometry is not fabricated", () => {
	it("returns the WindowServer frame and verification status", async () => {
		const applied = { x: 11, y: 12, width: 500, height: 400 };
		const computer = Object.assign(new FakeGuardedComputer(), {
			setWindowFrame: async (_pid: number, _windowId: number, frame: Rect) => ({
				requested: frame,
				applied,
				verified: false,
				attempts: 26,
			}),
		});
		const harness = await createHarness(computer);
		closeHarness = harness.close;
		const token = await observe(harness);

		const result = await harness.client.callTool({
			name: "set_window_frame",
			arguments: {
				app: "Finder",
				observation_token: token,
				x: 20,
				y: 30,
				width: 800,
				height: 600,
			},
		});

		expect(jsonPayload(result)["setWindowFrame"]).toEqual({
			requested: { x: 20, y: 30, width: 800, height: 600 },
			applied,
			verified: false,
			attempts: 26,
		});
	});
});

describe("clipboard_read #given several native pasteboard types #when read through MCP #then type enumeration is preserved", () => {
	it("is read-only and needs neither app nor token", async () => {
		const computer = Object.assign(new FakeGuardedComputer(), {
			readClipboard: () => ({
				types: ["public.utf8-plain-text", "public.png", "public.file-url"],
				text: "copied",
				fileUrls: ["file:///tmp/a.txt"],
			}),
		});
		const harness = await createHarness(computer);
		closeHarness = harness.close;

		const result = await harness.client.callTool({ name: "clipboard_read", arguments: {} });

		expect(jsonPayload(result)["types"]).toEqual(["public.utf8-plain-text", "public.png", "public.file-url"]);
		expect(computer.preflightExpected).toHaveLength(0);
	});
});

describe("clipboard_write #given a target-app token #when replacing clipboard text #then it runs inside the mutation queue", () => {
	it("preflights the target and reports that clipboard content was overwritten", async () => {
		const computer = Object.assign(new FakeGuardedComputer(), {
			writeClipboard: (_input: { readonly type: "text"; readonly text: string }) => ({
				overwritten: true as const,
				writtenType: "text" as const,
				types: ["public.utf8-plain-text"],
			}),
		});
		const harness = await createHarness(computer);
		closeHarness = harness.close;
		const token = await observe(harness);

		const result = await harness.client.callTool({
			name: "clipboard_write",
			arguments: { app: "Finder", observation_token: token, text: "replacement" },
		});

		expect(jsonPayload(result)["clipboardWrite"]).toEqual({
			overwritten: true,
			writtenType: "text",
			types: ["public.utf8-plain-text"],
		});
		expect(computer.preflightExpected).toHaveLength(1);
	});
});

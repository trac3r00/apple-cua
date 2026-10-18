import { afterEach, describe, expect, it } from "vitest";
import { createHarness, jsonPayload } from "./protocol-client-harness.js";

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	if (closeHarness !== undefined) {
		await closeHarness();
		closeHarness = undefined;
	}
});

async function start() {
	const harness = await createHarness();
	closeHarness = harness.close;
	return harness;
}

describe("run_script observations #given narrow options #when observed #then options reach the guarded session", () => {
	it("forwards menu bar, subtree, visibility, format, and screenshot preference", async () => {
		const harness = await start();
		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_script",
				arguments: {
					include_screenshot: true,
					code: `
						const finder = apple.app("Finder");
						return await finder.observe({
							includeScreenshot: false,
							includeMenuBar: true,
							subtreeOf: 0,
							visibleOnly: true,
							elementFormat: "table"
						});
					`,
				},
			}),
		);

		expect(payload).toMatchObject({ ok: true });
		expect(harness.computer.stateOptions[0]).toMatchObject({
			includeScreenshot: false,
			includeMenuBar: true,
			subtreeOf: 0,
			visibleOnly: true,
		});
		expect(payload["value"]).toMatchObject({
			element_columns: expect.any(String),
			element_rows: expect.any(Array),
		});
	});

	it("does not enable screenshots when the run prohibits them", async () => {
		const harness = await start();
		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_script",
				arguments: {
					code: `await apple.app("Finder").observe({ includeScreenshot: true });`,
				},
			}),
		);

		expect(payload).toMatchObject({ ok: true });
		expect(harness.computer.stateOptions[0]).toMatchObject({ includeScreenshot: false });
	});

	it.each([
		{ includeMenuBar: "yes" },
		{ subtreeOf: -1 },
		{ elementFormat: "xml" },
		{ includeScreenshot: "no" },
		{ visibleOnly: 1 },
		{ unexpected: true },
	])("rejects malformed options $", async (options) => {
		const harness = await start();
		const payload = jsonPayload(
			await harness.client.callTool({
				name: "run_script",
				arguments: {
					code: `await apple.app("Finder").observe(${JSON.stringify(options)});`,
				},
			}),
		);

		expect(payload).toMatchObject({ ok: false, kind: "action-failed" });
		expect(harness.computer.stateOptions).toEqual([]);
	});
});

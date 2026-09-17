import type { TopLevelWindow } from "@apple-cua/core";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, jsonPayload } from "./protocol-client-harness.js";

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	if (closeHarness !== undefined) {
		await closeHarness();
		closeHarness = undefined;
	}
});

const WINDOW_BOUNDS = { x: 352, y: 439, width: 920, height: 464 };

function probeWith(windows: readonly TopLevelWindow[]): () => Promise<readonly TopLevelWindow[]> {
	return async () => windows;
}

describe("window discovery #given a machine with on-screen windows #when the agent asks what it can target #then it gets ids and geometry", () => {
	it("lists window id, pid, app, title and bounds", async () => {
		const harness = await createHarness(
			undefined,
			probeWith([
				{ id: 38574, ownerPid: 489, ownerName: "Finder", title: "apple-cua", bounds: WINDOW_BOUNDS },
				{
					id: 38580,
					ownerPid: 76409,
					ownerName: "TextEdit",
					title: "scratch.txt",
					bounds: { ...WINDOW_BOUNDS, x: 213, y: 77 },
				},
			]),
		);
		closeHarness = harness.close;

		const result = await harness.client.callTool({ name: "list_windows", arguments: {} });
		const payload = jsonPayload(result);

		expect(result.isError).toBeFalsy();
		expect(payload["windows"]).toEqual([
			{ window_id: 38574, pid: 489, app: "Finder", title: "apple-cua", bounds: WINDOW_BOUNDS },
			{
				window_id: 38580,
				pid: 76409,
				app: "TextEdit",
				title: "scratch.txt",
				bounds: { ...WINDOW_BOUNDS, x: 213, y: 77 },
			},
		]);
	});

	it("answers with an empty list instead of failing when no window probe is available", async () => {
		const harness = await createHarness();
		closeHarness = harness.close;

		const result = await harness.client.callTool({ name: "list_windows", arguments: {} });

		expect(result.isError).toBeFalsy();
		expect(jsonPayload(result)["windows"]).toEqual([]);
	});
});

import { afterEach, describe, expect, it } from "vitest";
import { createHarness, jsonPayload, observe } from "./protocol-client-harness.js";
import { FakeGuardedComputer } from "./protocol-test-harness.js";

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	await closeHarness?.();
	closeHarness = undefined;
});

async function clickAtCoordinates(
	harness: Awaited<ReturnType<typeof createHarness>>,
): Promise<Record<string, unknown>> {
	const token = await observe(harness);
	const result = await harness.client.callTool({
		name: "click",
		arguments: { app: "Finder", observation_token: token, x: 10, y: 20 },
	});
	expect(result.isError).toBeFalsy();
	return jsonPayload(result);
}

describe("action delivery #given the driver's delivery mode #when input takes the foreground path #then the envelope names it", () => {
	it("reports the foreground for a coordinate click under attended delivery", async () => {
		const computer = new FakeGuardedComputer();
		computer.delivery = "attended";
		const harness = await createHarness(computer);
		closeHarness = harness.close;

		const payload = await clickAtCoordinates(harness);

		expect(payload["route"]).toBe("synthetic_events");
		expect(payload["delivery"]).toBe("foreground");
	});

	it("keeps reporting the background when the driver delivers in the background", async () => {
		const computer = new FakeGuardedComputer();
		computer.delivery = "background";
		const harness = await createHarness(computer);
		closeHarness = harness.close;

		const payload = await clickAtCoordinates(harness);

		expect(payload["route"]).toBe("synthetic_events");
		expect(payload["delivery"]).toBe("background");
	});

	it("keeps the accessibility route reported as background input", async () => {
		const computer = new FakeGuardedComputer();
		computer.delivery = "attended";
		const harness = await createHarness(computer);
		closeHarness = harness.close;
		const token = await observe(harness);

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "click",
				arguments: { app: "Finder", observation_token: token, element_index: "9" },
			}),
		);

		expect(payload["route"]).toBe("accessibility");
		expect(payload["delivery"]).toBe("background");
	});

	it("reports the foreground for typed text that falls back to synthetic events", async () => {
		const computer = new FakeGuardedComputer();
		computer.delivery = "attended";
		const harness = await createHarness(computer);
		closeHarness = harness.close;
		const token = await observe(harness);

		const payload = jsonPayload(
			await harness.client.callTool({
				name: "type_text",
				arguments: { app: "Finder", observation_token: token, text: "hello" },
			}),
		);

		expect(payload["route"]).toBe("synthetic_events");
		expect(payload["delivery"]).toBe("foreground");
	});
});

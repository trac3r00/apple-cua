import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StopStatus, StopStatusSource } from "@apple-cua/core";
import { StopSwitch } from "@apple-cua/core";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, jsonPayload, observe } from "./protocol-client-harness.js";
import { FakeGuardedComputer } from "./protocol-test-harness.js";

class MutableStop implements StopStatusSource {
	state: StopStatus = { stopped: false };

	stop(source: "chord" | "cli" = "cli"): void {
		this.state = { stopped: true, stoppedAt: "2026-01-01T00:00:00.000Z", reason: "test", source };
	}

	resume(): void {
		this.state = { stopped: false };
	}

	status(): StopStatus {
		return this.state;
	}
}

let closeHarness: (() => Promise<void>) | undefined;

afterEach(async () => {
	if (closeHarness !== undefined) {
		await closeHarness();
		closeHarness = undefined;
	}
});

describe("user stop #given the user stopped computer use #when an agent mutates #then input is refused", () => {
	it("refuses click and type_text with reason user-stopped and dispatches nothing", async () => {
		const stop = new MutableStop();
		const harness = await createHarness(new FakeGuardedComputer(), undefined, undefined, { stopSwitch: stop });
		closeHarness = harness.close;
		const token = await observe(harness);
		stop.stop();

		const click = await harness.client.callTool({
			name: "click",
			arguments: { app: "Finder", observation_token: token, element_index: "9" },
		});
		const typed = await harness.client.callTool({
			name: "type_text",
			arguments: { app: "Finder", observation_token: token, text: "hello" },
		});

		for (const result of [click, typed]) {
			expect(result.isError).toBe(true);
			expect(jsonPayload(result)).toMatchObject({
				actionDispatched: false,
				effect: "refused",
				reason: "user-stopped",
				escalation: { target: "human", reason: "user_stopped" },
				message: expect.stringContaining("apple-cua resume"),
			});
		}
		expect(harness.computer.effects.filter((effect) => effect.kind !== "close")).toEqual([]);
	});

	it("keeps read-only tools working while stopped", async () => {
		const stop = new MutableStop();
		const harness = await createHarness(new FakeGuardedComputer(), undefined, undefined, { stopSwitch: stop });
		closeHarness = harness.close;
		stop.stop();

		const state = await harness.client.callTool({ name: "get_app_state", arguments: { app: "Finder" } });
		const apps = await harness.client.callTool({ name: "list_apps", arguments: {} });

		expect(state.isError).not.toBe(true);
		expect(jsonPayload(state)["observation_token"]).toEqual(expect.any(String));
		expect(apps.isError).not.toBe(true);
	});

	it("stops run_steps at the step after the stop is triggered mid-batch", async () => {
		const stop = new MutableStop();
		const computer = new FakeGuardedComputer();
		const harness = await createHarness(computer, undefined, undefined, { stopSwitch: stop });
		closeHarness = harness.close;
		const token = await observe(harness);
		const originalType = computer.type.bind(computer);
		computer.type = async (text: string) => {
			await originalType(text);
			stop.stop("chord");
		};

		const result = await harness.client.callTool({
			name: "run_steps",
			arguments: {
				app: "Finder",
				observation_token: token,
				steps: [
					{ type: "click", element_index: "9" },
					{ type: "type_text", text: "first" },
					{ type: "type_text", text: "second" },
					{ type: "press_keys", keys: ["return"] },
				],
			},
		});
		const report = jsonPayload(result)["runSteps"];

		expect(harness.computer.effects.filter((effect) => effect.kind !== "close")).toEqual([
			{ kind: "performAction", pid: 1234, id: 9, action: "AXPress" },
			{ kind: "type", text: "first" },
		]);
		expect(report).toMatchObject({
			requested: 4,
			completed: 2,
			stoppedEarly: true,
			refused: "user-stopped",
			steps: [
				{ step: 0, status: "dispatched" },
				{ step: 1, status: "dispatched" },
				{
					step: 2,
					status: "skipped",
					input_dispatched: false,
					reason: expect.stringContaining("apple-cua resume"),
				},
				{ step: 3, status: "skipped", input_dispatched: false },
			],
		});
	});

	it("stops set_fields before the next field once the stop is triggered", async () => {
		const stop = new MutableStop();
		const computer = new FakeGuardedComputer();
		const harness = await createHarness(computer, undefined, undefined, { stopSwitch: stop });
		closeHarness = harness.close;
		const token = await observe(harness);
		const originalSetValue = computer.setValue.bind(computer);
		computer.setValue = async (pid: number, id: number, value: string) => {
			await originalSetValue(pid, id, value);
			stop.stop();
		};

		const result = await harness.client.callTool({
			name: "set_fields",
			arguments: {
				app: "Finder",
				observation_token: token,
				updates: [
					{ element_index: "20", value: "alpha" },
					{ element_index: "21", value: "beta" },
				],
			},
		});

		expect(harness.computer.effects.filter((effect) => effect.kind !== "close")).toEqual([
			{ kind: "setValue", pid: 1234, id: 20, value: "alpha" },
		]);
		expect(jsonPayload(result)["setFields"]).toMatchObject({
			inputDispatched: 1,
			stoppedEarly: true,
			refused: "user-stopped",
		});
	});

	it("allows mutations again after the user resumes", async () => {
		const stop = new MutableStop();
		const harness = await createHarness(new FakeGuardedComputer(), undefined, undefined, { stopSwitch: stop });
		closeHarness = harness.close;
		stop.stop();
		const refused = await harness.client.callTool({
			name: "type_text",
			arguments: { app: "Finder", observation_token: await observe(harness), text: "no" },
		});
		stop.resume();

		const token = await observe(harness);
		const typed = await harness.client.callTool({
			name: "type_text",
			arguments: { app: "Finder", observation_token: token, text: "yes" },
		});

		expect(refused.isError).toBe(true);
		expect(typed.isError).not.toBe(true);
		expect(harness.computer.effects.filter((effect) => effect.kind !== "close")).toEqual([
			{ kind: "type", text: "yes" },
		]);
	});

	it("refuses with the file-backed switch the CLI writes", async () => {
		const directory = mkdtempSync(join(tmpdir(), "apple-cua-stop-mcp-"));
		try {
			const fileSwitch = new StopSwitch(directory);
			const harness = await createHarness(new FakeGuardedComputer(), undefined, undefined, {
				stopSwitch: fileSwitch,
			});
			closeHarness = harness.close;
			const token = await observe(harness);
			fileSwitch.stop("from cli", "cli");

			const result = await harness.client.callTool({
				name: "type_text",
				arguments: { app: "Finder", observation_token: token, text: "x" },
			});

			expect(jsonPayload(result)).toMatchObject({ reason: "user-stopped" });
			expect(jsonPayload(result)["message"]).toEqual(expect.stringContaining("cli at"));
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});

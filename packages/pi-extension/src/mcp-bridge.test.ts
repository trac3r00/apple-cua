import { describe, expect, it, vi } from "vitest";

import { FAKE_TOOLS, FakeAppleCuaServer, textAnswer } from "../test/support/fake-apple-cua.js";
import { McpBridge } from "./mcp-bridge.js";

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
	let resolve: () => void = () => {};
	const promise = new Promise<void>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

function listAppsServer(): FakeAppleCuaServer {
	return new FakeAppleCuaServer(FAKE_TOOLS, "Set a goal, then observe.").handle("list_apps", () =>
		textAnswer([{ name: "TextEdit", bundleId: "com.apple.TextEdit" }]),
	);
}

describe("#given a started bridge #when it lists and calls tools #then the server's own surface comes through", () => {
	it("reads every tool and the server instructions", async () => {
		const bridge = new McpBridge(listAppsServer().connect);

		const started = await bridge.start();

		expect(started.tools.map((tool) => tool.name)).toEqual(FAKE_TOOLS.map((tool) => tool.name));
		expect(started.instructions).toBe("Set a goal, then observe.");
		await bridge.close();
	});

	it("forwards tools/call and hands each answer to the result listeners", async () => {
		const fake = listAppsServer();
		const bridge = new McpBridge(fake.connect);
		const listener = vi.fn();
		bridge.onToolResult(listener);
		await bridge.start();

		const result = await bridge.callTool("list_apps", {});

		expect(fake.calls).toEqual([{ name: "list_apps", args: {} }]);
		expect(result.content).toEqual([
			{ type: "text", text: JSON.stringify([{ name: "TextEdit", bundleId: "com.apple.TextEdit" }]) },
		]);
		expect(listener).toHaveBeenCalledWith("list_apps", {}, result);
		await bridge.close();
	});
});

describe("#given the server exits on its own #when calls continue #then it is restarted exactly once", () => {
	it("starts a fresh server for the next call and reports the exit", async () => {
		const fake = listAppsServer();
		const bridge = new McpBridge(fake.connect);
		const exited = vi.fn();
		bridge.onServerExit(exited);
		await bridge.start();

		await fake.exit();
		const result = await bridge.callTool("list_apps", {});

		expect(fake.connections).toBe(2);
		expect(exited).toHaveBeenCalledTimes(1);
		expect(result.isError).toBeUndefined();
		await bridge.close();
	});

	it("fails every later call with an error naming apple-cua doctor after a second exit", async () => {
		const fake = listAppsServer();
		fake.stderr = "Fatal error: koffi failed to load";
		const bridge = new McpBridge(fake.connect);
		await bridge.start();
		await fake.exit();
		await bridge.callTool("list_apps", {});

		await fake.exit();

		await expect(bridge.callTool("list_apps", {})).rejects.toThrow(/exited again after its one restart/);
		await expect(bridge.callTool("list_apps", {})).rejects.toThrow(/koffi failed to load.*apple-cua doctor/s);
		expect(fake.connections).toBe(2);
		await bridge.close();
	});

	it("fails the call in flight without replaying it, because its input may already be dispatched", async () => {
		const fake = listAppsServer();
		const started = deferred();
		const release = deferred();
		fake.handle("type_text", async () => {
			started.resolve();
			await release.promise;
			return textAnswer({ actionDispatched: true });
		});
		const bridge = new McpBridge(fake.connect);
		await bridge.start();

		const call = bridge.callTool("type_text", { app: "TextEdit", observation_token: "t1", text: "hi" });
		await started.promise;
		await fake.exit();

		await expect(call).rejects.toThrow(/exited while running type_text.*observe the app again before retrying/s);
		await bridge.callTool("list_apps", {});
		expect(fake.callsTo("type_text")).toHaveLength(1);
		release.resolve();
		await bridge.close();
	});
});

describe("#given the session ends #when the bridge closes #then the server stops and is not restarted", () => {
	it("closes the connection and refuses later calls", async () => {
		const fake = listAppsServer();
		const bridge = new McpBridge(fake.connect);
		await bridge.start();

		await bridge.close();

		expect(fake.closedConnections).toBe(1);
		expect(fake.connections).toBe(1);
		await expect(bridge.callTool("list_apps", {})).rejects.toThrow(/closed because the pi session ended/);
	});
});

describe("#given the server cannot start #when the bridge starts #then the launch error surfaces", () => {
	it("rejects with the connector's error", async () => {
		const bridge = new McpBridge(async () => {
			throw new Error("apple-cua: could not start /missing/helper. Run `apple-cua doctor`");
		});

		await expect(bridge.start()).rejects.toThrow(/could not start \/missing\/helper.*apple-cua doctor/);
	});
});

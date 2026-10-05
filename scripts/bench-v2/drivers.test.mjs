import assert from "node:assert/strict";
import { test } from "node:test";
import { Driver } from "./drivers.mjs";

test("#given a Cua multi-window refusal #when pressing a key #then it retries foreground on the exact window", async () => {
	const calls = [];
	const client = {
		async callTool(name, args) {
			calls.push({ name, args });
			if (name === "list_windows")
				return {
					structuredContent: {
						windows: [{ app_name: "TextEdit", title: "document.txt", is_on_screen: true, pid: 2, window_id: 4 }],
					},
				};
			if (args.delivery_mode !== "foreground")
				return { isError: true, content: [{ type: "text", text: "same_pid_keyboard_ambiguity" }] };
			return { content: [{ type: "text", text: "Posted key" }] };
		},
	};
	const driver = new Driver("cua", client);
	await driver.step({ op: "key", app: "TextEdit", title: "document.txt", cua: "s", modifiers: ["cmd"] });
	assert.deepEqual(calls.at(-1), {
		name: "press_key",
		args: { pid: 2, window_id: 4, key: "s", modifiers: ["cmd"], delivery_mode: "foreground" },
	});
	assert.equal(driver.calls, 3);
});

test("#given a rejected driver call #when recording latency #then the failed call is included", async () => {
	// Given: a tool that rejects immediately.
	const driver = new Driver("apple", {
		async callTool() {
			throw new Error("disconnected");
		},
	});
	// When: the driver calls the tool.
	await assert.rejects(driver.call("get_app_state", {}), /disconnected/);
	// Then: even unsuccessful calls have a duration entry.
	assert.equal(driver.call_ms.length, 1);
	assert.ok(driver.call_ms[0] >= 0);
});

test("#given a consumed apple token #when typing #then a new observation precedes the action", async () => {
	const names = [];
	const client = {
		async callTool(name, args) {
			names.push(name);
			if (name === "get_app_state")
				return {
					content: [{ type: "text", text: JSON.stringify({ observation_token: `token-${names.length}` }) }],
				};
			assert.equal(args.observation_token, `token-${names.length - 1}`);
			return { content: [{ type: "text", text: "{}" }] };
		},
	};
	const driver = new Driver("apple", client);
	await driver.step({ op: "type", app: "TextEdit", value: "first" });
	await driver.step({ op: "type", app: "TextEdit", value: "second" });
	assert.deepEqual(names, ["get_app_state", "type_text", "get_app_state", "type_text"]);
});

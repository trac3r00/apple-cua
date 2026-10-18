import assert from "node:assert/strict";
import test from "node:test";
import { Driver } from "./drivers.mjs";

test("#given an owned Cua window #when reobserving without a title #then no sibling receives input", async () => {
	const sibling = { pid: 1, window_id: 1510, app_name: "Finder", title: "home", is_on_screen: true };
	const owned = { ...sibling, window_id: 2, title: "fixture" };
	const calls = [];
	const driver = new Driver("cua", {
		callTool: async (name, args) => {
			calls.push({ name, args });
			if (name === "list_windows") return { structuredContent: { windows: [sibling, owned] } };
			if (name === "get_window_state")
				return { structuredContent: { elements: [{ label: "document.txt", element_token: "file-token" }] } };
			assert.equal(args.window_id, owned.window_id);
			return { content: [] };
		},
	});
	driver.windows.set("Finder", owned);
	await driver.step({ op: "click-label", app: "Finder", value: "document.txt" });
	assert.equal(calls.find((call) => call.name === "get_window_state").args.window_id, owned.window_id);
	assert.equal(driver.windows.get("Finder").window_id, owned.window_id);
});

test("#given an owned apple window #when resolving a described click #then scope is explicit", async () => {
	const driver = new Driver("apple", {
		callTool: async (name, args) => {
			assert.equal(name, "click_target");
			assert.equal(args.window_id, 2);
			return { content: [{ type: "text", text: JSON.stringify({ found: true, observation_token: "next" }) }] };
		},
	});
	driver.windows.set("Finder", { pid: 1, window_id: 2, title: "fixture" });
	await driver.step({ op: "click-label", app: "Finder", value: "document.txt" });
});

test("#given an owned apple window #when observing #then the sibling is not read first", async () => {
	const driver = new Driver("apple", {
		callTool: async (name, args) => {
			assert.equal(name, "get_app_state");
			assert.equal(args.window_id, 2);
			return {
				content: [{ type: "text", text: JSON.stringify({ windowTitle: "fixture", observation_token: "next" }) }],
			};
		},
	});
	driver.windows.set("Finder", { pid: 1, window_id: 2, title: "fixture" });
	await driver.observe("Finder", "fixture");
});

test("#given an error wire payload #when the driver rejects it #then retains the full raw response", async () => {
	const response = { isError: true, content: [{ type: "text", text: "failure ".repeat(1000) }] };
	const driver = new Driver("cua", { callTool: async () => response });
	await assert.rejects(driver.call("type_text", { text: "marker" }), /tool-error/);
	assert.deepEqual(driver.raw[0].result, response);
	assert.equal(driver.calls, 1);
	assert.equal(driver.allCallsSucceeded, false);
});

test("#given Cua menu contract #when invoking #then sends only supported menu arguments", async () => {
	const driver = new Driver("cua", {
		callTool: async (name, args) => {
			assert.equal(name, "invoke_menu");
			assert.deepEqual(args, { pid: 1, window_id: 2, path: ["File", "Save"] });
			return { content: [] };
		},
	});
	driver.windows.set("TextEdit", { pid: 1, window_id: 2 });
	await driver.act({ op: "menu", app: "TextEdit" }, {}, { path: ["File", "Save"] });
});

test("#given ambiguity #when input fails #then never retries foreground", async () => {
	const calls = [];
	const driver = new Driver("cua", {
		callTool: async (name, args) => {
			calls.push({ name, args });
			return { isError: true, content: [{ type: "text", text: "same_pid_keyboard_ambiguity" }] };
		},
	});
	driver.windows.set("TextEdit", { pid: 1, window_id: 2 });
	await assert.rejects(driver.primaryStep({ op: "type", app: "TextEdit", value: "marker" }), /ambiguity/);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].args.delivery_mode, "background");
	assert.equal(driver.allCallsSucceeded, false);
});

test("#given driver #when foreground requested #then refuses before dispatch", async () => {
	let calls = 0;
	const driver = new Driver("cua", {
		callTool: async () => {
			calls++;
		},
	});
	await assert.rejects(driver.call("click", { delivery_mode: "foreground" }), /needs-foreground/);
	assert.equal(calls, 0);
});

test("#given completed calls #when measuring #then retains raw evidence and wall latency", async () => {
	const driver = new Driver("apple", {
		callTool: async () => ({ content: [{ type: "text", text: "{}" }] }),
	});
	await driver.call("list_apps", {});
	assert.equal(driver.raw.length, 1);
	assert.equal(driver.calls, 1);
	assert.ok(driver.end_to_end_seconds >= 0);
	assert.equal(driver.allCallsSucceeded, true);
});

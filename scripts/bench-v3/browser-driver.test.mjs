import assert from "node:assert/strict";
import test from "node:test";
import { BrowserDriver } from "./browser-driver.mjs";

test("#given an offscreen owned Safari window #when selecting #then honors driver's hidden-window support", async () => {
	const driver = new BrowserDriver("cua", {
		callTool: async () => ({
			structuredContent: {
				windows: [
					{
						app_name: "Safari",
						title: "Personal — Owned benchmark fixture",
						is_on_screen: false,
						pid: 1,
						window_id: 2,
					},
					{ app_name: "Safari", title: "Personal page", is_on_screen: true, pid: 1, window_id: 3 },
				],
			},
		}),
	});
	assert.equal((await driver.window("Safari", "Owned benchmark fixture")).window_id, 2);
});

test("#given observed browser frame #when typing #then uses supported background coordinate arguments", async () => {
	const calls = [];
	const driver = new BrowserDriver("cua", {
		callTool: async (name, args) => {
			calls.push({ name, args });
			return { content: [] };
		},
	});
	driver.lastTargets.set("Safari", "Code");
	driver.observe = async () => ({
		structuredContent: {
			pid: 1,
			window_id: 2,
			capture_id: "captured",
			screenshot_frame_valid: true,
			elements: [{ label: "Code", role: "AXTextField", screenshot_frame: { x: 10, y: 20, w: 60, h: 30 } }],
		},
	});
	await driver.act({ op: "type", app: "Safari", value: "marker" }, {}, {});
	assert.deepEqual(calls[0].args, {
		pid: 1,
		window_id: 2,
		delivery_mode: "background",
		x: 40,
		y: 35,
		text: "marker",
	});
});

test("#given absent pixel proof #when typing #then refuses rather than guessing", async () => {
	const driver = new BrowserDriver("cua", { callTool: async () => assert.fail("must not dispatch") });
	driver.lastTargets.set("Safari", "Code");
	driver.observe = async () => ({ structuredContent: {} });
	await assert.rejects(driver.act({ op: "type", app: "Safari", value: "marker" }, {}, {}), /unprovable/);
});

import { afterEach, describe, expect, it } from "bun:test";
import { vi, whenSettled } from "@opencua/test-support";
import type { AXTreeElement } from "../../accessibility/types.js";
import { LinuxBackendError, LinuxHelperClient, record } from "./client.js";
import {
	type LinuxHelperEvents,
	type LinuxHelperFactory,
	type LinuxHostComputer,
	createLinuxHostComputer,
} from "./index.js";

class FakeHelper {
	readonly requests: Record<string, unknown>[] = [];
	readonly processes: LinuxHelperEvents[] = [];
	closed = 0;
	value = "before";
	actions: string[] = [];
	gone = false;
	snapshot = 0;
	hold = false;
	failure: { code: string; message: string } | undefined;
	readonly factory: LinuxHelperFactory = (events) => {
		this.processes.push(events);
		return {
			send: (line) => {
				const request = record(JSON.parse(line));
				this.requests.push(request);
				if (this.hold) return;
				if (this.failure) {
					events.line(JSON.stringify({ id: request["id"], error: this.failure }));
					return;
				}
				const params = record(request["params"]);
				const method = request["method"];
				let result: unknown = true;
				switch (method) {
					case "snapshot": {
						++this.snapshot;
						const elements: AXTreeElement[] = [];
						if (record(params["options"])["includeAccessibilityTree"] !== false) {
							elements.push({
								id: this.snapshot,
								role: "text",
								label: "Document",
								value: this.value,
								frame: { x: 110, y: 220, width: 100, height: 30 },
								actions: ["click", "toggle", "select", "scroll down"],
								children: [],
							});
						}
						result = {
							app: { name: "Editor", bundleId: "", pid: 17, isFrontmost: true },
							windows: [{ id: 99, title: "Document", bounds: { x: 100, y: 200, width: 800, height: 600 } }],
							window: { id: 99, title: "Document", bounds: { x: 100, y: 200, width: 800, height: 600 } },
							snapshotId: `snapshot-${this.snapshot}`,
							truncated: false,
							elements,
						};
						break;
					}
					case "screenshot":
						result = {
							data: Buffer.from("image").toString("base64"),
							mimeType: "image/png",
							width: 400,
							height: 300,
							scope: params["windowId"] === undefined ? "screen" : "window",
						};
						break;
					case "listApps":
						result = [{ name: "Editor", bundleId: "", pid: 17, isFrontmost: true }];
						break;
					case "listWindows":
						result = [{ id: 99, title: "Document", bounds: { x: 100, y: 200, width: 800, height: 600 } }];
						break;
					case "screenSize":
						result = { width: 1920, height: 1080 };
						break;
					case "cursor":
						result = { x: 42, y: 19 };
						break;
					case "focusedType":
						this.value += String(params["text"]);
						break;
					case "act": {
						const ref = record(params["ref"]);
						if (this.gone || ref["snapshotId"] !== `snapshot-${this.snapshot}`) {
							events.line(
								JSON.stringify({ id: request["id"], error: { code: "STALE_REF", message: "Removed" } }),
							);
							return;
						}
						const action = String(params["action"]);
						this.actions.push(action);
						if (action === "setValue") this.value = String(params["value"]);
						if (action === "type") this.value += String(params["text"]);
						if (action === "frame") result = { x: 110, y: 220, width: 100, height: 30 };
						break;
					}
					case "physical":
						this.actions.push(String(params["operation"]));
						break;
					default:
						throw new Error(`Unexpected method ${method}`);
				}
				events.line(JSON.stringify({ id: request["id"], result }));
			},
			close: () => ++this.closed,
		};
	};

	reply(index: number, result: unknown): void {
		const request = this.requests[index];
		const process = this.processes.at(-1);
		if (!request || !process) throw new Error("No pending request");
		process.line(JSON.stringify({ id: request["id"], result }));
	}

	crash(): void {
		const process = this.processes.at(-1);
		if (!process) throw new Error("No running process");
		process.exit(new LinuxBackendError("HELPER_CRASH", "fixture crash"));
	}
}

const computers: LinuxHostComputer[] = [];
const clients: LinuxHelperClient[] = [];

function setup(physical = false): { helper: FakeHelper; computer: LinuxHostComputer } {
	const helper = new FakeHelper();
	const computer = createLinuxHostComputer({ helperFactory: helper.factory, physical });
	computers.push(computer);
	computer.setTarget(17);
	return { helper, computer };
}

async function observed(physical = false): Promise<ReturnType<typeof setup>> {
	const fixture = setup(physical);
	await fixture.computer.getAppState();
	return fixture;
}

afterEach(async () => {
	await Promise.all(computers.splice(0).map((computer) => computer.close()));
	for (const client of clients.splice(0)) client.close();
	vi.useRealTimers();
});

describe("Linux background host", () => {
	it("#given a window #when observed #then maps frames into screenshot pixels and retains a global viewport", async () => {
		const { computer } = setup();
		const state = await computer.getAppState();
		expect(state.elements[0]?.frame).toEqual({ x: 5, y: 10, width: 50, height: 15 });
		expect(state).toMatchObject({ app: "Editor", pid: 17, axAvailable: true, captureScope: "window", windowId: 99 });
		expect(await computer.getScreenshotViewport(17)).toEqual({
			windowBounds: { x: 100, y: 200, width: 800, height: 600 },
			screenshotWidth: 400,
			screenshotHeight: 300,
		});
	});

	it("#given screenshot disabled #when observed #then skips capture and keeps screen-space frames", async () => {
		const { computer, helper } = setup();
		const state = await computer.getAppState(17, { includeScreenshot: false });
		expect(state.screenshotBase64).toBe("");
		expect(state.elements[0]?.frame).toEqual({ x: 110, y: 220, width: 100, height: 30 });
		expect(helper.requests.some((request) => request["method"] === "screenshot")).toBe(false);
		expect(await computer.getScreenshotViewport(17)).toBeUndefined();
	});

	it("#given capture-only options #when observed #then revokes prior element authorization", async () => {
		const { computer } = await observed();
		const ref = computer.elementRef(17, 1);
		const state = await computer.getAppState(17, { includeAccessibilityTree: false });
		expect(state.treeSkipped).toBe(true);
		expect(state.elements).toEqual([]);
		await expect(computer.act(ref, "click")).rejects.toMatchObject({ code: "STALE_REF" });
	});

	it("#given a snapshot #when an element is replaced #then propagates STALE_REF without physical fallback", async () => {
		const { computer, helper } = await observed();
		const ref = computer.elementRef(17, 1);
		helper.gone = true;
		await expect(computer.act(ref, "click")).rejects.toMatchObject({ code: "STALE_REF" });
		expect(helper.actions).toEqual([]);
	});

	it("#given an older snapshot #when its numeric id is used after observation #then rejects rather than rebinding", async () => {
		const { computer, helper } = await observed();
		const ref = computer.elementRef(17, 1);
		await computer.getAppState();
		expect(() => computer.assertObservationCurrent(17, ref.snapshotId)).toThrowError(LinuxBackendError);
		await expect(computer.performAction(17, 1, "click")).rejects.toMatchObject({ code: "STALE_REF" });
		await expect(computer.act(ref, "click")).rejects.toMatchObject({ code: "STALE_REF" });
		expect(helper.actions).toEqual([]);
	});

	it.each(["click", "rightClick", "middleClick", "doubleClick"] as const)(
		"#given observed coordinates #when %s runs in background #then delivers an element action",
		async (method) => {
			const { computer, helper } = await observed();
			await computer[method]({ x: 120, y: 225 });
			expect(helper.actions).toEqual([method]);
			expect(helper.requests.some((request) => request["method"] === "physical")).toBe(false);
		},
	);

	it("#given EditableText #when setValue and ref typing run #then subsequent observation contains the edits", async () => {
		const { computer } = await observed();
		await computer.setValue(17, 1, "changed");
		await computer.act(computer.elementRef(17, 1), "type", { text: "!" });
		expect((await computer.getAppState()).elements[0]?.value).toBe("changed!");
	});

	it.each(["toggle", "select", "AXPress"])(
		"#given a semantic control #when %s is requested #then uses the observed ref",
		async (action) => {
			const { computer, helper } = await observed();
			await computer.performAction(17, 1, action);
			expect(helper.actions).toEqual([action]);
		},
	);

	it("#given text #when selectText runs #then uses the semantic selection interface", async () => {
		const { computer, helper } = await observed();
		await computer.selectText(17, 1, { selection: "text", text: "before" });
		expect(helper.actions).toEqual(["selectText"]);
	});

	it("#given existing focus #when type and typeIntoFocused run #then insert without changing focus", async () => {
		const { computer } = setup();
		await computer.type(" one");
		expect(await computer.typeIntoFocused(17, " two")).toBe(true);
		expect((await computer.getAppState()).elements[0]?.value).toBe("before one two");
	});

	it("#given an observed point #when pressAtPosition runs #then presses only that observed element", async () => {
		const { computer, helper } = await observed();
		expect(await computer.pressAtPosition(17, { x: 120, y: 225 })).toBe(true);
		expect(await computer.pressAtPosition(17, { x: 0, y: 0 })).toBe(false);
		expect(helper.actions).toEqual(["click"]);
		expect(await computer.elementFrame(17, 1)).toEqual({ x: 110, y: 220, width: 100, height: 30 });
	});

	it("#given an observed scroll control #when scrolling #then repeats semantic actions without pointer commands", async () => {
		const { computer, helper } = await observed();
		await computer.scroll({ direction: "down", amount: 2, position: { x: 120, y: 225 } });
		expect(helper.actions).toEqual(["scroll down", "scroll down"]);
	});

	it("#given background mode #when unsafe input is requested #then refuses before contacting the helper", async () => {
		const { computer, helper } = setup();
		await expect(computer.move({ x: 1, y: 2 })).rejects.toMatchObject({ code: "PHYSICAL_INPUT_REQUIRED" });
		await expect(computer.key("alt+tab")).rejects.toMatchObject({ code: "PHYSICAL_INPUT_REQUIRED" });
		await expect(computer.drag({ from: { x: 1, y: 2 }, to: { x: 3, y: 4 } })).rejects.toMatchObject({
			code: "PHYSICAL_INPUT_REQUIRED",
		});
		await expect(computer.scroll({ direction: "up", amount: 1 })).rejects.toMatchObject({
			code: "PHYSICAL_INPUT_REQUIRED",
		});
		await expect(computer.click({ x: 1, y: 2 }, { modifiers: ["ctrl"] })).rejects.toMatchObject({
			code: "PHYSICAL_INPUT_REQUIRED",
		});
		expect(helper.requests).toEqual([]);
	});

	it("#given no matching observed point #when clicked #then requires a new observation", async () => {
		const { computer } = await observed();
		await expect(computer.click({ x: 0, y: 0 })).rejects.toMatchObject({ code: "STALE_REF" });
	});

	it("#given a full-screen capture #when screenshot runs #then returns bytes and an explicit scope notice", async () => {
		const { computer } = setup();
		const image = await computer.screenshot({ format: "png", region: { x: 0, y: 0, width: 20, height: 30 } });
		expect(image.data.toString()).toBe("image");
		expect(image.scope).toBe("screen");
		expect(image.captureNotice).toBeDefined();
	});

	it("#given app and window inventories #when read #then return shared interface shapes", async () => {
		const { computer } = setup();
		const apps = await computer.listApps();
		expect(apps).toEqual([{ name: "Editor", bundleId: "", pid: 17, isRunning: true, isFrontmost: true }]);
		expect(await computer.listAppIdentities()).toEqual(apps);
		expect(await computer.listWindows(17)).toEqual([
			{ id: 99, title: "Document", bounds: { x: 100, y: 200, width: 800, height: 600 } },
		]);
		expect(await computer.getCursorPosition()).toEqual({ x: 42, y: 19 });
		expect(await computer.getScreenSize()).toEqual({ width: 1920, height: 1080 });
	});

	it("#given no explicit target #when observing #then can read the active app without activating it", async () => {
		const { computer } = setup();
		computer.setTarget();
		expect((await computer.getAppState()).pid).toBe(17);
		await expect(computer.type("input")).rejects.toMatchObject({ code: "NO_TARGET" });
	});

	it("#given an observed host #when its helper crashes #then observation authorization is revoked", async () => {
		const { computer, helper } = await observed();
		helper.crash();
		expect(() => computer.assertObservationCurrent(17, "snapshot-1")).toThrowError(LinuxBackendError);
		expect(await computer.getScreenshotViewport(17)).toBeUndefined();
		await expect(computer.performAction(17, 1, "click")).rejects.toMatchObject({ code: "STALE_REF" });
		await computer.getAppState();
		expect(helper.processes).toHaveLength(2);
	});

	it("#given background operations #when their full workflow completes #then never sends any physical tool command", async () => {
		const { computer, helper } = await observed();
		await computer.click({ x: 120, y: 225 });
		await computer.type("safe");
		await computer.setValue(17, 1, "safe");
		await computer.performAction(17, 1, "toggle");
		await computer.getCursorPosition();
		await computer.listWindows(17);
		expect(JSON.stringify(helper.requests)).not.toMatch(/xdotool|ydotool|"physical"/);
	});

	it("#given physical opt-in #when all input methods run #then includes explicit permission in each helper request", async () => {
		const { computer, helper } = setup(true);
		const position = { x: 4, y: 5 };
		await computer.move(position);
		await computer.click(position);
		await computer.rightClick(position);
		await computer.middleClick(position);
		await computer.doubleClick(position);
		await computer.type("headed");
		await computer.key("enter");
		await computer.scroll({ direction: "down", amount: 1 });
		await computer.drag({ from: position, to: { x: 8, y: 9 } });
		expect(helper.actions).toEqual([
			"move",
			"click",
			"rightClick",
			"middleClick",
			"doubleClick",
			"type",
			"key",
			"scroll",
			"drag",
		]);
		expect(helper.requests.every((request) => record(request["params"])["physical"] === true)).toBe(true);
	});

	it("#given a closed computer #when used again #then rejects and never restarts the helper", async () => {
		const { computer, helper } = await observed();
		await computer.close();
		await expect(computer.listApps()).rejects.toMatchObject({ code: "CLOSED" });
		expect(helper.closed).toBe(1);
		expect(helper.processes).toHaveLength(1);
	});
});

describe("Linux helper transport lifecycle", () => {
	function client(helper: FakeHelper): LinuxHelperClient {
		const result = new LinuxHelperClient({ helperFactory: helper.factory, timeoutMs: 500 });
		clients.push(result);
		return result;
	}

	it("#given concurrent requests #when replies arrive out of order #then resolves by request id on one process", async () => {
		const helper = new FakeHelper();
		helper.hold = true;
		const connection = client(helper);
		const first = connection.request("first");
		const second = connection.request("second");
		helper.reply(1, "second result");
		helper.reply(0, "first result");
		expect(await Promise.all([first, second])).toEqual(["first result", "second result"]);
		expect(helper.processes).toHaveLength(1);
	});

	it("#given a blocked native call #when its deadline expires #then rejects all pending calls and restarts without replay", async () => {
		vi.useFakeTimers();
		const helper = new FakeHelper();
		helper.hold = true;
		const connection = client(helper);
		const first = connection.request("blocked");
		const second = connection.request("queued");
		const rejection = whenSettled(Promise.all([first, second]), (settled) =>
			expect(settled).rejects.toMatchObject({ code: "TIMEOUT" }),
		);
		await vi.advanceTimersByTimeAsync(500);
		await rejection;
		expect(helper.closed).toBe(1);
		helper.hold = false;
		expect(await connection.request("screenSize")).toEqual({ width: 1920, height: 1080 });
		expect(helper.processes).toHaveLength(2);
		expect(helper.requests.map((request) => request["method"])).toEqual(["blocked", "queued", "screenSize"]);
	});

	it("#given a helper crash #when pending requests exist #then rejects them and ignores late responses from that process", async () => {
		const helper = new FakeHelper();
		helper.hold = true;
		const connection = client(helper);
		const pending = connection.request("old");
		const rejection = whenSettled(pending, (settled) =>
			expect(settled).rejects.toMatchObject({ code: "HELPER_CRASH" }),
		);
		const old = helper.processes[0];
		helper.crash();
		await rejection;
		const fresh = connection.request("new");
		old?.line(JSON.stringify({ id: 2, result: "wrong process" }));
		helper.reply(1, "fresh");
		expect(await fresh).toBe("fresh");
	});

	it("#given missing GI dependencies #when called #then includes exact package manager install hints", async () => {
		const helper = new FakeHelper();
		helper.failure = { code: "MISSING_DEPENDENCY", message: "Python GI/AT-SPI unavailable" };
		const connection = client(helper);
		await expect(connection.request("listApps")).rejects.toMatchObject({
			code: "MISSING_DEPENDENCY",
			message: expect.stringContaining("sudo apt install python3 python3-gi gir1.2-atspi-2.0"),
		});
		await expect(connection.request("listApps")).rejects.toThrow(
			"sudo dnf install python3 python3-gobject at-spi2-core",
		);
		await expect(connection.request("listApps")).rejects.toThrow("sudo pacman -S python python-gobject at-spi2-core");
	});

	it("#given malformed helper output #when received #then rejects pending calls instead of hanging", async () => {
		const helper = new FakeHelper();
		helper.hold = true;
		const connection = client(helper);
		const pending = connection.request("test");
		const rejection = whenSettled(pending, (settled) => expect(settled).rejects.toThrow());
		helper.processes[0]?.line("not json");
		await rejection;
		expect(helper.closed).toBe(1);
	});

	it("#given a pending call #when closed #then rejects immediately and clears its timeout", async () => {
		vi.useFakeTimers();
		const helper = new FakeHelper();
		helper.hold = true;
		const connection = client(helper);
		const pending = connection.request("pending");
		const rejection = whenSettled(pending, (settled) => expect(settled).rejects.toMatchObject({ code: "CLOSED" }));
		connection.close();
		await rejection;
		expect(vi.getTimerCount()).toBe(0);
	});
});

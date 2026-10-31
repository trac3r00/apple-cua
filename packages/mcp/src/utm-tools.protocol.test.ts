import { afterEach, describe, expect, it } from "bun:test";
import type { StopStatusSource, UTMObservation } from "@apple-cua/core";
import { vi } from "@apple-cua/test-support";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { UTM } from "../../core/src/platform/utm.js";
import { createHarness } from "./protocol-client-harness.js";
import { UTM_TOOL_NAMES, toolNamesFor } from "./tool-names.js";
import { type UtmToolSource, registerUtmTools } from "./utm-tools.js";

const VM = "12345678-1234-4234-8234-123456789abc";
const OTHER_VM = "12345678-1234-4234-8234-123456789abd";
const machines = [
	{ id: VM, name: "Linux", status: "started", backend: "qemu" },
	{ id: OTHER_VM, name: "Other Linux", status: "started", backend: "qemu" },
];

class FakeUtm implements UtmToolSource {
	machines = machines.map((vm) => ({ ...vm }));
	calls: unknown[] = [];
	captures: string[] = [];
	listCalls = 0;
	beforeList: (() => Promise<void>) | undefined;
	beforeObserve: (() => Promise<void>) | undefined;
	afterInput: (() => void) | undefined;
	captureError = false;
	observation: UTMObservation = {
		image: { data: Buffer.from("png"), mimeType: "image/png", width: 800, height: 600 },
		windowId: 7,
		displayRect: { x: 20, y: 50, width: 760, height: 540 },
		guestSize: { width: 1520, height: 1080 },
		cursor: { x: 10, y: 20 },
		texts: [
			{ text: "Save", confidence: 0.99, box: { x: 100, y: 200, width: 80, height: 40 } },
			{ text: "Save as", confidence: 0.9, box: { x: 200, y: 300, width: 100, height: 40 } },
		],
	};

	async observe(vm: string): Promise<UTMObservation> {
		await this.beforeObserve?.();
		if (this.captureError) throw new Error("capture failed");
		this.captures.push(vm);
		return this.observation;
	}

	async move(vm: string, point: { x: number; y: number }): Promise<void> {
		this.calls.push({ action: "move", vm, point });
		this.afterInput?.();
	}

	async clickObserved(vm: string, point: { x: number; y: number }, observation: UTMObservation): Promise<void> {
		this.calls.push({ action: "click-image", vm, point, observation });
		this.afterInput?.();
	}

	async list(): Promise<typeof this.machines> {
		this.listCalls++;
		await this.beforeList?.();
		return this.machines.map((vm) => ({ ...vm }));
	}

	async screenshot(vm: string): Promise<UTMObservation["image"]> {
		if (this.captureError) throw new Error("capture failed");
		this.captures.push(vm);
		return { data: Buffer.from("png"), mimeType: "image/png", width: 800, height: 600 };
	}

	async click(
		vm: string,
		point: { x: number; y: number },
		options?: { button?: "left" | "right" | "middle"; monitor?: number },
	): Promise<void> {
		this.calls.push({ action: "click", vm, point, options });
		this.afterInput?.();
	}

	async type(vm: string, text: string): Promise<void> {
		this.calls.push({ action: "type", vm, text });
		this.afterInput?.();
	}

	async key(vm: string, combo: string): Promise<void> {
		this.calls.push({ action: "key", vm, combo });
		this.afterInput?.();
	}
}

const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
	for (const close of cleanup.splice(0)) await close();
	vi.unstubAllEnvs();
});

async function connect(
	source: FakeUtm,
	options: { stopSwitch?: StopStatusSource; now?: () => number; ttlMs?: number } = {},
): Promise<Client> {
	vi.stubEnv("APPLE_CUA_ALLOWED_BUNDLE_IDS", "com.utmapp.UTM");
	const server = new McpServer({ name: "utm-protocol-test", version: "0.0.0" });
	registerUtmTools(server, source, options);
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	const client = new Client({ name: "utm-test-client", version: "0.0.0" });
	cleanup.push(async () => {
		await client.close();
		await server.close();
	});
	await client.connect(clientTransport);
	return client;
}

function payload(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
	const content = z.array(z.looseObject({ type: z.string(), text: z.string().optional() })).parse(result.content);
	const text = content.find((item) => item.type === "text")?.text;
	if (text === undefined) throw new Error("Expected tool text");
	return z.record(z.string(), z.unknown()).parse(JSON.parse(text));
}

async function observe(client: Client, vm = VM): Promise<string> {
	const result = await client.callTool({ name: "utm_observe", arguments: { vm } });
	return z.string().parse(payload(result)["observation_token"]);
}

async function run(
	client: Client,
	token: string,
	vm = VM,
	steps: readonly unknown[] = [{ action: "type", text: "hi" }],
) {
	return client.callTool({ name: "utm_run", arguments: { vm, observation_token: token, steps } });
}

function signal(): { promise: Promise<void>; resolve: () => void } {
	let resolve: () => void = () => undefined;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("optional UTM MCP protocol", () => {
	it("#given registered tools #when listing and observing #then returns UUID context and exact VM image", async () => {
		const source = new FakeUtm();
		const client = await connect(source);
		const screenshot = vi.spyOn(source, "screenshot");
		const inventory = await client.callTool({ name: "utm_list", arguments: {} });
		const observation = await client.callTool({ name: "utm_observe", arguments: { vm: VM } });

		expect(payload(inventory)).toEqual({ vms: machines });
		expect(payload(observation)).toMatchObject({
			vm: machines[0],
			screenshot_space: "host-window-including-chrome",
			input_space: "guest-display-pixels",
			width: 800,
			height: 600,
			displayRect: source.observation.displayRect,
			guestSize: source.observation.guestSize,
			cursor: { x: 10, y: 20 },
			texts: [
				{ ...source.observation.texts[0], element_id: expect.any(String) },
				{ ...source.observation.texts[1], element_id: expect.any(String) },
			],
			observation_token: expect.any(String),
		});
		expect(observation.content).toContainEqual({
			type: "image",
			data: Buffer.from("png").toString("base64"),
			mimeType: "image/png",
		});
		expect(source.captures).toEqual([VM]);
		expect(screenshot).not.toHaveBeenCalled();
	});

	it("#given guest coordinates #when moving #then routes guest pixels without host input", async () => {
		const source = new FakeUtm();
		const client = await connect(source);
		const token = await observe(client);
		expect(
			(await run(client, token, VM, [{ action: "move", x: 500, y: 300, coordinate_space: "guest-display-pixels" }]))
				.isError,
		).not.toBe(true);
		expect(source.calls).toEqual([{ action: "move", vm: VM, point: { x: 500, y: 300 } }]);
	});

	it("#given chrome and letterboxing #when clicking image #then core maps the stored observation", async () => {
		const source = new FakeUtm();
		source.observation = { ...source.observation, guestSize: { width: 1080, height: 1080 } };
		const client = await connect(source);
		const token = await observe(client);
		const core = new UTM();
		const capture = vi.spyOn(core, "observe").mockResolvedValue(source.observation);
		const click = vi.spyOn(core, "click").mockResolvedValue();
		const observed = vi.spyOn(source, "clickObserved").mockImplementation(async (vm, point, observation) => {
			await core.clickObserved(vm, point, observation);
		});
		try {
			const result = payload(await run(client, token, VM, [{ action: "click-image", x: 400, y: 320 }]));
			expect(result).toMatchObject({ stepsCompleted: 1, observation_token: expect.any(String) });
			expect(observed).toHaveBeenCalledWith(VM, { x: 400, y: 320 }, source.observation);
			expect(click).toHaveBeenCalledWith(VM, { x: 540, y: 540 });
		} finally {
			capture.mockRestore();
			click.mockRestore();
			observed.mockRestore();
		}
	});

	it.each(["save", "as"])(
		"#given OCR targets #when matching %s #then chooses a unique exact or contains target",
		async (text) => {
			const source = new FakeUtm();
			const client = await connect(source);
			const token = await observe(client);
			expect((await run(client, token, VM, [{ action: "click-text", text }])).isError).not.toBe(true);
			expect(source.calls).toEqual([
				{
					action: "click",
					vm: VM,
					point: text === "save" ? { x: 140, y: 220 } : { x: 250, y: 320 },
					options: undefined,
				},
			]);
		},
	);

	it.each(["Sa", "missing"])("#given ambiguous or absent OCR #when matching %s #then refuses input", async (text) => {
		const source = new FakeUtm();
		const client = await connect(source);
		const token = await observe(client);
		expect(payload(await run(client, token, VM, [{ action: "click-text", text }]))["reason"]).toBe(
			"utm-text-target-not-unique",
		);
		expect(source.calls).toEqual([]);
	});

	it("#given duplicate exact OCR matches #when clicking text #then refuses ambiguity", async () => {
		const source = new FakeUtm();
		source.observation = {
			...source.observation,
			texts: [
				...source.observation.texts,
				{ text: "SAVE", confidence: 1, box: { x: 10, y: 10, width: 20, height: 20 } },
			],
		};
		const client = await connect(source);
		const token = await observe(client);
		expect(payload(await run(client, token, VM, [{ action: "click-text", text: "save" }]))["reason"]).toBe(
			"utm-text-target-not-unique",
		);
		expect(source.calls).toEqual([]);
	});

	it("#given allowlist revoked during visual capture #when capture returns #then dispatches no input", async () => {
		const source = new FakeUtm();
		const client = await connect(source);
		const token = await observe(client);
		source.beforeObserve = async () => {
			vi.stubEnv("APPLE_CUA_ALLOWED_BUNDLE_IDS", "com.apple.finder");
		};
		expect(payload(await run(client, token, VM, [{ action: "click-image", x: 400, y: 320 }]))["reason"]).toBe(
			"app-not-allowed",
		);
		expect(source.calls).toEqual([]);
	});

	it("#given an OCR target moved #when clicking its old observation #then input is refused", async () => {
		const source = new FakeUtm();
		const client = await connect(source);
		const token = await observe(client);
		source.observation = {
			...source.observation,
			texts: source.observation.texts.map((entry) => ({ ...entry, box: { ...entry.box, y: entry.box.y + 40 } })),
		};
		expect(payload(await run(client, token, VM, [{ action: "click-text", text: "Save" }]))["reason"]).toBe(
			"utm-text-target-changed",
		);
		expect(source.calls).toEqual([]);
	});

	it("#given OCR ids #when authority refreshes #then old ids cannot target new observations", async () => {
		const source = new FakeUtm();
		const client = await connect(source);
		const result = payload(await client.callTool({ name: "utm_observe", arguments: { vm: VM } }));
		const targets = z.array(z.object({ element_id: z.string() })).parse(result["texts"]);
		const element_id = targets[0]?.element_id;
		const token = z.string().parse(result["observation_token"]);
		expect((await run(client, token, VM, [{ action: "click-text", element_id }])).isError).not.toBe(true);
		const fresh = await observe(client);
		expect(payload(await run(client, fresh, VM, [{ action: "click-text", element_id }]))["reason"]).toBe(
			"utm-text-target-not-unique",
		);
		expect(source.calls).toHaveLength(1);
	});

	it.each(["windowId", "displayRect", "guestSize"] as const)(
		"#given changed %s #when visual input runs #then rejects before input",
		async (field) => {
			const source = new FakeUtm();
			const client = await connect(source);
			const token = await observe(client);
			switch (field) {
				case "windowId":
					source.observation = { ...source.observation, windowId: 8 };
					break;
				case "displayRect":
					source.observation = {
						...source.observation,
						displayRect: { ...source.observation.displayRect, x: 30 },
					};
					break;
				case "guestSize":
					source.observation = { ...source.observation, guestSize: { width: 1000, height: 1000 } };
					break;
			}
			expect(payload(await run(client, token, VM, [{ action: "click-image", x: 400, y: 320 }]))["reason"]).toBe(
				"utm-geometry-changed",
			);
			expect(source.calls).toEqual([]);
		},
	);

	it.each(["click-image", "click-text"])(
		"#given earlier mutation #when batch continues with %s #then refuses stale references",
		async (action) => {
			const source = new FakeUtm();
			const client = await connect(source);
			const token = await observe(client);
			const visual = action === "click-image" ? { action, x: 400, y: 320 } : { action, text: "Save" };
			expect(payload(await run(client, token, VM, [{ action: "key", combo: "a" }, visual]))).toMatchObject({
				reason: "utm-visual-reference-stale",
				stepsCompleted: 1,
			});
			expect(source.calls).toHaveLength(1);
		},
	);

	it("#given earlier mutation #when batch refreshes #then visual text uses refreshed content", async () => {
		const source = new FakeUtm();
		const client = await connect(source);
		const token = await observe(client);
		source.afterInput = () => {
			source.observation = {
				...source.observation,
				texts: [{ text: "New", confidence: 1, box: { x: 10, y: 10, width: 20, height: 20 } }],
			};
		};
		expect(
			payload(
				await run(client, token, VM, [
					{ action: "key", combo: "a" },
					{ action: "observe" },
					{ action: "click-text", text: "New" },
				]),
			),
		).toMatchObject({ stepsCompleted: 2 });
		expect(source.calls).toContainEqual({ action: "click", vm: VM, point: { x: 20, y: 20 }, options: undefined });
	});

	it.each([false, true])(
		"#given earlier mutation %s #when observe precedes image click #then refuses an unseen image",
		async (mutate) => {
			const source = new FakeUtm();
			const client = await connect(source);
			const token = await observe(client);
			const result = await run(client, token, VM, [
				...(mutate ? [{ action: "key", combo: "a" }] : []),
				{ action: "observe" },
				{ action: "click-image", x: 400, y: 320 },
			]);
			expect(result.isError).toBe(true);
			expect(payload(result)).toMatchObject({
				reason: "utm-visual-reference-stale",
				stepsCompleted: mutate ? 1 : 0,
				actionDispatched: mutate,
			});
			expect(source.calls).toEqual(mutate ? [{ action: "key", vm: VM, combo: "a" }] : []);
		},
	);

	it.each([
		{ partial: false, prior: false },
		{ partial: true, prior: false },
		{ partial: true, prior: true },
	])(
		"#given partial type $partial and prior input $prior #when typing throws #then reports honest progress",
		async ({ partial, prior }) => {
			const source = new FakeUtm();
			const client = await connect(source);
			const token = await observe(client);
			const type = vi.spyOn(source, "type").mockImplementation(async (vm, text) => {
				if (partial) source.calls.push({ action: "type", vm, text: text.slice(0, 1) });
				throw new Error("typing failed");
			});
			try {
				const result = await run(client, token, VM, [
					...(prior ? [{ action: "key", combo: "a" }] : []),
					{ action: "type", text: "hello" },
					{ action: "key", combo: "b" },
				]);
				expect(result.isError).toBe(true);
				expect(payload(result)).toMatchObject({
					reason: "utm-failed",
					stepsCompleted: prior ? 1 : 0,
					actionDispatched: prior ? true : "unknown",
				});
				expect(payload(result)["observation_token"]).toBeUndefined();
				expect(source.calls).toEqual([
					...(prior ? [{ action: "key", vm: VM, combo: "a" }] : []),
					...(partial ? [{ action: "type", vm: VM, text: "h" }] : []),
				]);
			} finally {
				type.mockRestore();
			}
		},
	);

	it("#given observed QEMU VM #when running native inputs #then returns fresh one-use authority", async () => {
		const source = new FakeUtm();
		const client = await connect(source);
		const token = await observe(client);
		const result = await run(client, token, VM, [
			{ action: "type", text: "hello" },
			{ action: "key", combo: "ctrl+a" },
			{ action: "click", x: 1200, y: 900, coordinate_space: "guest-display-pixels", button: "right", monitor: 1 },
		]);
		const reused = await run(client, token);

		expect(source.calls).toEqual([
			{ action: "type", vm: VM, text: "hello" },
			{ action: "key", vm: VM, combo: "ctrl+a" },
			{ action: "click", vm: VM, point: { x: 1200, y: 900 }, options: { button: "right", monitor: 1 } },
		]);
		expect(payload(result)).toMatchObject({ stepsCompleted: 3, actionDispatched: true });
		expect(payload(result)["observation_token"]).toEqual(expect.any(String));
		expect(payload(result)["observation_token"]).not.toBe(token);
		expect(payload(reused)["reason"]).toBe("utm-token-invalid");
	});

	it("#given a newer observation #when old authority is used #then refuses before mutation", async () => {
		const source = new FakeUtm();
		const client = await connect(source);
		const token = await observe(client);
		await observe(client);
		expect(payload(await run(client, token))["reason"]).toBe("utm-token-invalid");
		expect(source.calls).toEqual([]);
	});

	it("#given a token for another UUID #when input targets another VM #then refuses without consuming correct authority", async () => {
		const source = new FakeUtm();
		const client = await connect(source);
		const token = await observe(client);
		await observe(client, OTHER_VM);
		expect(payload(await run(client, token, OTHER_VM))["reason"]).toBe("utm-token-invalid");
		expect(source.calls).toEqual([]);
		expect((await run(client, token)).isError).not.toBe(true);
	});

	it("#given expired authority #when input runs #then refuses before mutation", async () => {
		let now = 0;
		const source = new FakeUtm();
		const client = await connect(source, { now: () => now, ttlMs: 100 });
		const token = await observe(client);
		now = 101;
		expect(payload(await run(client, token))["reason"]).toBe("utm-token-expired");
		expect(source.calls).toEqual([]);
	});

	it.each(["status", "backend"] as const)(
		"#given changed %s #when input runs #then refuses stale VM context",
		async (field) => {
			const source = new FakeUtm();
			const client = await connect(source);
			const token = await observe(client);
			source.machines = source.machines.map((vm) => ({ ...vm, [field]: "changed" }));
			expect(payload(await run(client, token))["reason"]).toBe("utm-context-changed");
			expect(source.calls).toEqual([]);
		},
	);

	it.each([
		{ status: "started", backend: "apple" },
		{ status: "stopped", backend: "qemu" },
	])("#given unsupported VM $status/$backend #when input runs #then refuses native input", async (state) => {
		const source = new FakeUtm();
		source.machines = source.machines.map((vm) => ({ ...vm, ...state }));
		const client = await connect(source);
		const token = await observe(client);
		expect(payload(await run(client, token))["reason"]).toBe("utm-input-unavailable");
		expect(source.calls).toEqual([]);
	});

	it("#given concurrent reuse during VM resolution #when both calls finish #then only one input runs", async () => {
		const source = new FakeUtm();
		const client = await connect(source);
		const token = await observe(client);
		const entered = signal();
		const release = signal();
		source.beforeList = async () => {
			entered.resolve();
			await release.promise;
		};
		const first = run(client, token);
		await entered.promise;
		const second = run(client, token);
		release.resolve();
		const results = await Promise.all([first, second]);
		expect(source.calls).toHaveLength(1);
		expect(results.filter((result) => result.isError === true)).toHaveLength(1);
	});

	it("#given stop during asynchronous VM resolution #when resolution completes #then dispatches no input", async () => {
		let stopped = false;
		const source = new FakeUtm();
		const client = await connect(source, {
			stopSwitch: {
				status: () =>
					stopped
						? { stopped: true, stoppedAt: "2026-10-23T00:00:00Z", reason: "test", source: "chord" }
						: { stopped: false },
			},
		});
		const token = await observe(client);
		const entered = signal();
		const release = signal();
		source.beforeList = async () => {
			entered.resolve();
			await release.promise;
		};
		const pending = run(client, token);
		await entered.promise;
		stopped = true;
		release.resolve();
		expect(payload(await pending)["reason"]).toBe("user-stopped");
		expect(source.calls).toEqual([]);
	});

	it("#given stop after the first input #when a batch continues #then preserves partial dispatch without authority", async () => {
		let stopped = false;
		const source = new FakeUtm();
		const client = await connect(source, {
			stopSwitch: {
				status: () =>
					stopped
						? { stopped: true, stoppedAt: "2026-10-23T00:00:00Z", reason: "test", source: "chord" }
						: { stopped: false },
			},
		});
		const token = await observe(client);
		source.afterInput = () => {
			stopped = true;
		};
		const result = payload(
			await run(client, token, VM, [
				{ action: "key", combo: "a" },
				{ action: "key", combo: "b" },
			]),
		);
		expect(result).toMatchObject({ reason: "user-stopped", actionDispatched: true, stepsCompleted: 1 });
		expect(result["observation_token"]).toBeUndefined();
		expect(source.calls).toHaveLength(1);
	});

	it.each(["", "com.apple.finder"])(
		"#given UTM excluded by allowlist %s #when tools run #then inventory observation and mutation are all blocked",
		async (allowed) => {
			const source = new FakeUtm();
			const client = await connect(source);
			const token = await observe(client);
			const reads = source.listCalls;
			vi.stubEnv("APPLE_CUA_ALLOWED_BUNDLE_IDS", allowed);
			const results = await Promise.all([
				client.callTool({ name: "utm_list", arguments: {} }),
				client.callTool({ name: "utm_observe", arguments: { vm: VM } }),
				run(client, token),
			]);
			for (const result of results) expect(payload(result)["reason"]).toBe("app-not-allowed");
			expect(source.listCalls).toBe(reads);
			expect(source.captures).toEqual([VM]);
			expect(source.calls).toEqual([]);
		},
	);

	it.each(["com.utmapp.utm", "COM.UTMAPP.UTM", "com.apple.finder,CoM.UtMaPp.UtM"])(
		"#given allowlist casing %s #when listing observing and running #then permits UTM",
		async (allowed) => {
			const source = new FakeUtm();
			const client = await connect(source);
			vi.stubEnv("APPLE_CUA_ALLOWED_BUNDLE_IDS", allowed);
			expect((await client.callTool({ name: "utm_list", arguments: {} })).isError).not.toBe(true);
			const token = await observe(client);
			expect((await run(client, token)).isError).not.toBe(true);
			expect(source.calls).toEqual([{ action: "type", vm: VM, text: "hi" }]);
		},
	);

	it("#given failed post-input capture #when reporting #then retains dispatch evidence without a new token", async () => {
		const source = new FakeUtm();
		const client = await connect(source);
		const token = await observe(client);
		source.afterInput = () => {
			source.captureError = true;
		};
		const result = payload(await run(client, token));
		expect(result).toMatchObject({ reason: "utm-failed", stepsCompleted: 1, actionDispatched: true });
		expect(result["observation_token"]).toBeUndefined();
	});

	it.each([
		{ action: "click", x: 1, y: 2 },
		{ action: "click", x: 1, y: 2, coordinate_space: "host-window-including-chrome" },
		{ action: "scroll", direction: "down" },
		{ action: "drag", x: 1, y: 2 },
		{ action: "start" },
	])("#given unsupported or ambiguous input $action #when calling utm_run #then rejects the schema", async (step) => {
		const source = new FakeUtm();
		const client = await connect(source);
		const token = await observe(client);
		expect((await run(client, token, VM, [step])).isError).toBe(true);
		expect(source.calls).toEqual([]);
	});

	it.each(["0", "1"])(
		"#given APPLE_CUA_UTM=%s #when server tools list #then matches opt-in capability names",
		async (flag) => {
			vi.stubEnv("APPLE_CUA_UTM", flag);
			vi.stubEnv("APPLE_CUA_BROWSER", "off");
			const harness = await createHarness(undefined, undefined, undefined, {
				serverOptions: { toolset: "lean", iphone: false },
			});
			cleanup.push(harness.close);
			const names = (await harness.client.listTools()).tools.map((tool) => tool.name);
			expect(names.sort()).toEqual([...toolNamesFor("lean", false, false, flag === "1")].sort());
			for (const name of UTM_TOOL_NAMES) expect(names.includes(name)).toBe(flag === "1");
		},
	);
});

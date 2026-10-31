import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Mock } from "bun:test";
import { writeFileSync } from "node:fs";
import type { UTM } from "@apple-cua/core";
import { vi } from "@apple-cua/test-support";
import { Command } from "commander";

const core = vi.hoisted(() => {
	const methods = {
		list: vi.fn<() => Promise<readonly { id: string; name: string; status: string; backend: string }[]>>(),
		start: vi.fn<(vm: string) => Promise<void>>(),
		suspend: vi.fn<(vm: string) => Promise<void>>(),
		stop: vi.fn<(vm: string) => Promise<void>>(),
		type: vi.fn<(vm: string, text: string) => Promise<void>>(),
		key: vi.fn<(vm: string, combo: string) => Promise<void>>(),
		observe: vi.fn<UTM["observe"]>(),
		move: vi.fn<UTM["move"]>(),
		clickObserved: vi.fn<UTM["clickObserved"]>(),
		click: vi.fn<
			(
				vm: string,
				point: { x: number; y: number },
				options?: { button?: "left" | "right" | "middle"; monitor?: number },
			) => Promise<void>
		>(),
		screenshot:
			vi.fn<(vm: string) => Promise<{ data: Buffer; mimeType: "image/png"; width: number; height: number }>>(),
	};
	return {
		methods,
		UTM: vi.fn((_options?: { appPath?: string }) => methods),
	};
});

vi.mock("@apple-cua/core", () => ({ UTM: core.UTM }));
vi.mock("node:fs", () => ({ writeFileSync: vi.fn() }));

const { registerUtmCommands } = await import("./utm.js");

const machines = [{ id: "vm-123", name: "Linux guest", status: "started", backend: "QEMU" }];
const observation: Awaited<ReturnType<UTM["observe"]>> = {
	image: { data: Buffer.from("observed PNG fixture"), mimeType: "image/png", width: 1000, height: 800 },
	displayRect: { x: 20, y: 60, width: 960, height: 720 },
	guestSize: { width: 1920, height: 1440 },
	windowId: 42,
	texts: [{ text: "Settings", confidence: 0.98, box: { x: 101, y: 203, width: 50, height: 25 } }],
	cursor: { x: 12, y: 34 },
};
let stdout: Mock<typeof process.stdout.write>;

function createProgram(): Command {
	const program = new Command()
		.option("--json")
		.exitOverride()
		.configureOutput({ writeErr: () => undefined });
	registerUtmCommands(program, { isJsonOutput: () => program.opts<{ json?: boolean }>().json === true });
	return program;
}

beforeEach(() => {
	vi.clearAllMocks();
	core.methods.list.mockResolvedValue(machines);
	core.methods.observe.mockResolvedValue(observation);
	for (const action of ["start", "suspend", "stop", "type", "key", "click", "move", "clickObserved"] as const) {
		core.methods[action].mockResolvedValue(undefined);
	}
	stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("#given UTM commands #when Commander parses them #then calls route to core", () => {
	it("uses the selected app path and global JSON output for list", async () => {
		await createProgram().parseAsync(["--json", "utm", "--app", "/Applications/Custom UTM.app", "list"], {
			from: "user",
		});

		expect(core.UTM.mock.calls).toEqual([[{ appPath: "/Applications/Custom UTM.app" }]]);
		expect(core.methods.list.mock.calls).toEqual([[]]);
		expect(stdout.mock.calls).toEqual([[`${JSON.stringify(machines)}\n`]]);
	});

	it("prints VM identifiers, names, states, and backends without JSON", async () => {
		await createProgram().parseAsync(["utm", "list"], { from: "user" });

		expect(core.UTM.mock.calls).toEqual([[{}]]);
		expect(stdout.mock.calls).toEqual([["vm-123\tLinux guest\tstarted\tQEMU\n"]]);
	});

	it.each(["start", "suspend", "stop"] as const)("routes %s with the exact VM name", async (action) => {
		await createProgram().parseAsync(["utm", "--app", "/custom/UTM.app", action, "Linux guest", "--json"], {
			from: "user",
		});

		expect(core.UTM.mock.calls).toEqual([[{ appPath: "/custom/UTM.app" }]]);
		expect(core.methods[action].mock.calls).toEqual([["Linux guest"]]);
		expect(stdout.mock.calls).toEqual([[`${JSON.stringify({ ok: true, action, args: { vm: "Linux guest" } })}\n`]]);
	});

	it.each([
		{ action: "type", value: "hello\n\u4e16\u754c", field: "text" },
		{ action: "key", value: "ctrl+alt+delete", field: "combo" },
	] as const)("passes $action input unchanged", async ({ action, value, field }) => {
		await createProgram().parseAsync(["--json", "utm", action, "vm-123", value], { from: "user" });

		expect(core.methods[action].mock.calls).toEqual([["vm-123", value]]);
		expect(stdout.mock.calls).toEqual([
			[`${JSON.stringify({ ok: true, action, args: { vm: "vm-123", [field]: value } })}\n`],
		]);
	});

	it("passes zero coordinates without inventing click options", async () => {
		await createProgram().parseAsync(["utm", "click", "vm-123", "-x", "0", "-y", "0"], { from: "user" });

		expect(core.methods.click.mock.calls).toEqual([["vm-123", { x: 0, y: 0 }, {}]]);
		expect(core.methods.observe).not.toHaveBeenCalled();
		expect(core.methods.clickObserved).not.toHaveBeenCalled();
	});

	it("routes screenshot coordinates through a fresh observation", async () => {
		await createProgram().parseAsync(["utm", "click", "vm-123", "-x", "120", "-y", "240", "--image-coordinates"], {
			from: "user",
		});

		expect(core.methods.observe.mock.calls).toEqual([["vm-123"]]);
		expect(core.methods.clickObserved.mock.calls).toEqual([["vm-123", { x: 120, y: 240 }, observation]]);
		expect(core.methods.click).not.toHaveBeenCalled();
	});

	it("routes guest cursor movement and JSON output", async () => {
		await createProgram().parseAsync(["--json", "utm", "move", "vm-123", "-x", "0", "-y", "34"], { from: "user" });

		expect(core.methods.move.mock.calls).toEqual([["vm-123", { x: 0, y: 34 }]]);
		expect(core.methods.observe).not.toHaveBeenCalled();
		expect(stdout.mock.calls).toEqual([
			[`${JSON.stringify({ ok: true, action: "move", args: { vm: "vm-123", x: 0, y: 34 } })}\n`],
		]);
	});

	it.each([undefined, "observed.png"])("omits observation image bytes with output %j", async (output) => {
		await createProgram().parseAsync(
			["--json", "utm", "observe", "vm-123", ...(output === undefined ? [] : ["--output", output])],
			{ from: "user" },
		);

		const { image, ...metadata } = observation;
		expect(core.methods.observe.mock.calls).toEqual([["vm-123"]]);
		expect(stdout.mock.calls).toEqual([
			[
				`${JSON.stringify({
					ok: true,
					action: "observe",
					args: { vm: "vm-123", ...(output === undefined ? {} : { output }) },
					image: { mimeType: image.mimeType, width: image.width, height: image.height },
					...metadata,
					...(output === undefined ? {} : { output }),
				})}\n`,
			],
		]);
		expect(vi.mocked(writeFileSync).mock.calls).toEqual(output === undefined ? [] : [[output, image.data]]);
	});

	it("includes OCR guest boxes in human observation output", async () => {
		await createProgram().parseAsync(["utm", "observe", "vm-123"], { from: "user" });

		expect(stdout.mock.calls).toHaveLength(1);
		const output = stdout.mock.calls[0]?.[0];
		expect(typeof output).toBe("string");
		if (typeof output !== "string") throw new TypeError("Expected metadata output");
		expect(JSON.parse(output)).toMatchObject({
			texts: observation.texts,
			image: { width: 1000, height: 800 },
			guestSize: observation.guestSize,
		});
		expect(JSON.parse(output).image).not.toHaveProperty("data");
	});

	it.each(["sEtTiNgS", "etti"])("clicks a unique OCR match %j in guest pixels", async (query) => {
		await createProgram().parseAsync(["utm", "click-text", "vm-123", query], { from: "user" });

		expect(core.methods.observe.mock.calls).toEqual([["vm-123"], ["vm-123"]]);
		expect(core.methods.click.mock.calls).toEqual([["vm-123", { x: 126, y: 215 }]]);
		expect(core.methods.observe.mock.invocationCallOrder[1]).toBeLessThan(
			core.methods.click.mock.invocationCallOrder[0] ?? 0,
		);
		expect(core.methods.clickObserved).not.toHaveBeenCalled();
	});

	it.each(["x", "y", "width", "height"] as const)(
		"allows two pixels of OCR box %s drift at the original target",
		async (field) => {
			core.methods.observe.mockResolvedValueOnce(observation).mockResolvedValueOnce({
				...observation,
				texts: observation.texts.map((entry) => ({
					...entry,
					box: { ...entry.box, [field]: entry.box[field] + 2 },
				})),
			});

			await createProgram().parseAsync(["utm", "click-text", "vm-123", "settings"], { from: "user" });

			expect(core.methods.click.mock.calls).toEqual([["vm-123", { x: 126, y: 215 }]]);
		},
	);

	it.each([
		{ change: "window", fresh: { ...observation, windowId: 43 } },
		...(["width", "height"] as const).map((field) => ({
			change: `guest ${field}`,
			fresh: { ...observation, guestSize: { ...observation.guestSize, [field]: observation.guestSize[field] + 1 } },
		})),
		...(["x", "y", "width", "height"] as const).map((field) => ({
			change: `display ${field}`,
			fresh: {
				...observation,
				displayRect: { ...observation.displayRect, [field]: observation.displayRect[field] + 1 },
			},
		})),
		...(["x", "y", "width", "height"] as const).map((field) => ({
			change: `OCR box ${field}`,
			fresh: {
				...observation,
				texts: observation.texts.map((entry) => ({
					...entry,
					box: { ...entry.box, [field]: entry.box[field] + 3 },
				})),
			},
		})),
		{ change: "disappeared text", fresh: { ...observation, texts: [] } },
		{
			change: "changed text",
			fresh: { ...observation, texts: observation.texts.map((entry) => ({ ...entry, text: "Settings changed" })) },
		},
		{ change: "duplicate target", fresh: { ...observation, texts: [...observation.texts, ...observation.texts] } },
	])("refuses stale click-text after $change", async ({ fresh }) => {
		core.methods.observe.mockResolvedValueOnce(observation).mockResolvedValueOnce(fresh);

		await expect(
			createProgram().parseAsync(["utm", "click-text", "vm-123", "settings"], { from: "user" }),
		).rejects.toThrow(/observe again/);

		expect(core.methods.observe.mock.calls).toEqual([["vm-123"], ["vm-123"]]);
		expect(core.methods.click).not.toHaveBeenCalled();
		expect(core.methods.clickObserved).not.toHaveBeenCalled();
		expect(stdout).not.toHaveBeenCalled();
	});

	it("propagates revalidation observation failure without clicking", async () => {
		const error = new Error("Fresh observation failed");
		core.methods.observe.mockResolvedValueOnce(observation).mockRejectedValueOnce(error);

		await expect(
			createProgram().parseAsync(["utm", "click-text", "vm-123", "settings"], { from: "user" }),
		).rejects.toBe(error);

		expect(core.methods.click).not.toHaveBeenCalled();
		expect(stdout).not.toHaveBeenCalled();
	});

	it("prefers an exact OCR match over substring matches", async () => {
		core.methods.observe.mockResolvedValueOnce({
			...observation,
			texts: [
				{ text: "More Settings", confidence: 1, box: { x: 0, y: 0, width: 10, height: 10 } },
				...observation.texts,
			],
		});

		await createProgram().parseAsync(["utm", "click-text", "vm-123", "settings"], { from: "user" });

		expect(core.methods.click.mock.calls).toEqual([["vm-123", { x: 126, y: 215 }]]);
	});

	it.each([
		{ texts: [], query: "settings", error: /No OCR text matches/ },
		{ texts: [...observation.texts, ...observation.texts], query: "settings", error: /Ambiguous OCR text query/ },
		{ texts: [...observation.texts, ...observation.texts], query: "etti", error: /Ambiguous OCR text query/ },
	])("refuses OCR query $query when matching fails: $error", async ({ texts, query, error }) => {
		core.methods.observe.mockResolvedValueOnce({ ...observation, texts });

		await expect(
			createProgram().parseAsync(["utm", "click-text", "vm-123", query], { from: "user" }),
		).rejects.toThrow(error);

		expect(core.methods.click).not.toHaveBeenCalled();
		expect(core.methods.clickObserved).not.toHaveBeenCalled();
		expect(stdout).not.toHaveBeenCalled();
	});

	it.each([
		{ method: "observe", args: ["observe", "vm-123"] },
		{ method: "observe", args: ["click-text", "vm-123", "settings"] },
		{ method: "observe", args: ["click", "vm-123", "-x", "0", "-y", "0", "--image-coordinates"] },
		{ method: "clickObserved", args: ["click", "vm-123", "-x", "0", "-y", "0", "--image-coordinates"] },
		{ method: "click", args: ["click-text", "vm-123", "settings"] },
		{ method: "move", args: ["move", "vm-123", "-x", "0", "-y", "0"] },
	] as const)("propagates $method failure for $args without success output", async ({ method, args }) => {
		const error = new Error("VM observation or input failed");
		core.methods[method].mockRejectedValueOnce(error);

		await expect(createProgram().parseAsync(["utm", ...args], { from: "user" })).rejects.toBe(error);

		expect(stdout).not.toHaveBeenCalled();
	});

	it.each(["left", "right", "middle"] as const)("routes a %s click and monitor number", async (button) => {
		await createProgram().parseAsync(
			["--json", "utm", "click", "vm-123", "--x", "12", "--y", "34", "--button", button, "--monitor", "2"],
			{ from: "user" },
		);

		expect(core.methods.click.mock.calls).toEqual([["vm-123", { x: 12, y: 34 }, { button, monitor: 2 }]]);
		expect(stdout.mock.calls).toEqual([
			[
				`${JSON.stringify({ ok: true, action: "click", args: { vm: "vm-123", x: 12, y: 34, button, monitor: 2 } })}\n`,
			],
		]);
	});

	it("writes screenshot bytes to the selected output and reports image metadata", async () => {
		const data = Buffer.from("PNG fixture");
		core.methods.screenshot.mockResolvedValue({ data, mimeType: "image/png", width: 800, height: 600 });

		await createProgram().parseAsync(["--json", "utm", "screenshot", "vm-123", "-o", "guest.png"], { from: "user" });

		expect(core.methods.screenshot.mock.calls).toEqual([["vm-123"]]);
		expect(vi.mocked(writeFileSync).mock.calls).toEqual([["guest.png", data]]);
		expect(stdout.mock.calls).toEqual([
			[
				`${JSON.stringify({
					ok: true,
					action: "screenshot",
					args: { vm: "vm-123", output: "guest.png" },
					output: "guest.png",
					mimeType: "image/png",
					width: 800,
					height: 600,
				})}\n`,
			],
		]);
	});

	it("propagates core failures without printing success", async () => {
		const error = new Error("VM unavailable");
		core.methods.start.mockRejectedValueOnce(error);

		await expect(createProgram().parseAsync(["utm", "start", "vm-123"], { from: "user" })).rejects.toBe(error);

		expect(stdout).not.toHaveBeenCalled();
	});
});

describe("#given invalid UTM arguments #when Commander parses them #then core is untouched", () => {
	it.each(
		[
			["--button", "right"],
			["--monitor", "2"],
		].map((row) => [row]),
	)("rejects unsupported screenshot click options %j", async (flags) => {
		await expect(
			createProgram().parseAsync(["utm", "click", "vm-123", "-x", "0", "-y", "0", "--image-coordinates", ...flags], {
				from: "user",
			}),
		).rejects.toThrow(/cannot be combined/);

		expect(core.UTM).not.toHaveBeenCalled();
	});

	it.each(["", " "])("rejects an empty OCR query %j", async (query) => {
		await expect(
			createProgram().parseAsync(["utm", "click-text", "vm-123", query], { from: "user" }),
		).rejects.toThrow(/must not be empty/);

		expect(core.UTM).not.toHaveBeenCalled();
	});

	it.each(
		["click", "move"].flatMap((action) =>
			["--x", "--y"].flatMap((flag) =>
				["-1", "1.5", "NaN", "Infinity", "12px", "", " ", "9007199254740992"].map((value) => ({
					action,
					flag,
					value,
				})),
			),
		),
	)("rejects $action coordinate $flag=$value", async ({ action, flag, value }) => {
		await expect(
			createProgram().parseAsync(["utm", action, "vm-123", "-x", "0", "-y", "0", flag, value], { from: "user" }),
		).rejects.toMatchObject({ code: "commander.invalidArgument" });

		expect(core.UTM).not.toHaveBeenCalled();
	});

	it.each(["0", "-1", "1.5", "NaN", "Infinity", "2px", "", "9007199254740992"])(
		"rejects monitor %j",
		async (monitor) => {
			await expect(
				createProgram().parseAsync(["utm", "click", "vm-123", "-x", "0", "-y", "0", "--monitor", monitor], {
					from: "user",
				}),
			).rejects.toMatchObject({ code: "commander.invalidArgument" });

			expect(core.UTM).not.toHaveBeenCalled();
		},
	);

	it.each(["other", "Left", ""])("rejects button %j", async (button) => {
		await expect(
			createProgram().parseAsync(["utm", "click", "vm-123", "-x", "0", "-y", "0", "--button", button], {
				from: "user",
			}),
		).rejects.toMatchObject({ code: "commander.invalidArgument" });

		expect(core.UTM).not.toHaveBeenCalled();
	});

	it.each(
		[
			["start"],
			["suspend"],
			["stop"],
			["type", "vm-123"],
			["key", "vm-123"],
			["click", "vm-123", "-x", "0"],
			["click", "vm-123", "-y", "0"],
			["screenshot", "vm-123"],
			["observe"],
			["move", "vm-123", "-x", "0"],
			["move", "vm-123", "-y", "0"],
			["click-text", "vm-123"],
		].map((row) => [row]),
	)("requires missing arguments for %j", async (args) => {
		await expect(createProgram().parseAsync(["utm", ...args], { from: "user" })).rejects.toThrow();

		expect(core.UTM).not.toHaveBeenCalled();
	});
});

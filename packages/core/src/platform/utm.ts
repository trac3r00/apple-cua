import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { assertInputMayContinue, currentInputScope } from "../computer/input-scope.js";
import type { ScreenshotResult } from "../computer/interface.js";
import type { Point, Size } from "../types/index.js";
import { execFileStdout } from "./exec-util.js";
import { StopSwitch, describeUserStop } from "./stop-switch.js";
import { windowsGuestDisplay } from "./utm-guest.js";
import { utmKeyCodes, utmTextCodes } from "./utm-keys.js";
import { captureUtmDisplay, mapUtmPoint } from "./utm-visual.js";

export interface UTMObservation {
	readonly image: ScreenshotResult;
	readonly displayRect: import("../types/index.js").Rect;
	readonly texts: readonly import("./macos-ffi/vision.js").OcrTextObservation[];
	readonly windowId: number;
	readonly guestSize: Size;
	readonly cursor?: Point;
}

const execute = promisify(execFile);
export const UTM_BUNDLE_ID = "com.utmapp.UTM";

export interface UTMVirtualMachine {
	readonly id: string;
	readonly name: string;
	readonly status: string;
	readonly backend: string;
}

export class UTMError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UTMError";
	}
}

/** Native UTM scripting, independent of host focus, pointer position, and guest tools. */
export class UTM {
	readonly appPath: string;
	private readonly stopSwitch = new StopSwitch();
	private readonly cursors = new Map<string, Point>();

	constructor(options: { readonly appPath?: string } = {}) {
		const local = join(homedir(), "Applications", "UTM.app");
		this.appPath = options.appPath?.trim() ? options.appPath : existsSync(local) ? local : "/Applications/UTM.app";
	}

	async list(): Promise<readonly UTMVirtualMachine[]> {
		const raw: unknown = JSON.parse(
			await this.script(
				"return JSON.stringify(u.virtualMachines().map(v => ({id:v.id(),name:v.name(),status:v.status(),backend:v.backend()})));",
			),
		);
		if (
			!Array.isArray(raw) ||
			!raw.every(
				(vm: unknown): vm is UTMVirtualMachine =>
					typeof vm === "object" &&
					vm !== null &&
					"id" in vm &&
					typeof vm.id === "string" &&
					"name" in vm &&
					typeof vm.name === "string" &&
					"status" in vm &&
					typeof vm.status === "string" &&
					"backend" in vm &&
					typeof vm.backend === "string",
			)
		) {
			throw new UTMError("Invalid virtual machine inventory from UTM");
		}
		return raw;
	}

	async start(vm: string): Promise<void> {
		await this.mutate(vm, "u.start(v);", false);
	}

	async suspend(vm: string): Promise<void> {
		await this.mutate(vm, "u.suspend(v, {saving:true});", false);
	}

	/** Request guest shutdown; never uses UTM's default forced power off. */
	async stop(vm: string): Promise<void> {
		await this.mutate(vm, 'u.stop(v, {by:"request"});', false);
	}

	async type(vm: string, text: string): Promise<void> {
		if ([...text].some((character) => character.charCodeAt(0) > 127)) {
			throw new UTMError("UTM keystrokes support ASCII text only");
		}
		const normalized = text.replaceAll("\r\n", "\n");
		utmTextCodes(normalized);
		for (const character of normalized) {
			const codes = utmTextCodes(character);
			await this.mutate(vm, `u.inputScanCode(v, {codes:${JSON.stringify(codes)}});`, true);
		}
	}

	async key(vm: string, combo: string): Promise<void> {
		await this.mutate(vm, `u.inputScanCode(v, {codes:${JSON.stringify(utmKeyCodes(combo))}});`, true);
	}

	async observe(vm: string): Promise<UTMObservation> {
		const windowId = await this.windowId(vm);
		const guestSize = await windowsGuestDisplay((body) => this.script(body), this.select(vm));
		const result = await captureUtmDisplay(windowId, guestSize);
		const cursor = this.cursors.get(vm);
		return { ...result, guestSize, ...(cursor === undefined ? {} : { cursor }) };
	}

	/** Move the guest's own virtual cursor, without moving or borrowing the host pointer. */
	async move(vm: string, point: Point): Promise<void> {
		if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0) {
			throw new UTMError("Guest cursor coordinates must be finite and nonnegative");
		}
		this.assertMayContinue();
		await windowsGuestDisplay(
			(body) => {
				this.assertMayContinue();
				return this.script(body);
			},
			this.select(vm),
			point,
			(body) => this.script(body),
		);
		this.cursors.set(vm, point);
	}

	async clickObserved(vm: string, point: Point, observation: UTMObservation): Promise<void> {
		const current = await this.observe(vm);
		if (
			current.windowId !== observation.windowId ||
			current.guestSize.width !== observation.guestSize.width ||
			current.guestSize.height !== observation.guestSize.height ||
			current.displayRect.x !== observation.displayRect.x ||
			current.displayRect.y !== observation.displayRect.y ||
			current.displayRect.width !== observation.displayRect.width ||
			current.displayRect.height !== observation.displayRect.height
		) {
			throw new UTMError("UTM display changed; observe again");
		}
		const guest = mapUtmPoint(point, observation.displayRect, observation.guestSize);
		const stableText =
			observation.texts.length === current.texts.length &&
			observation.texts.every((entry) =>
				current.texts.some(
					(fresh) =>
						fresh.text === entry.text &&
						Math.abs(fresh.box.x - entry.box.x) <= 2 &&
						Math.abs(fresh.box.y - entry.box.y) <= 2 &&
						Math.abs(fresh.box.width - entry.box.width) <= 2 &&
						Math.abs(fresh.box.height - entry.box.height) <= 2,
				),
			);
		const textTarget = observation.texts.some(
			({ box }) =>
				guest.x >= box.x && guest.y >= box.y && guest.x < box.x + box.width && guest.y < box.y + box.height,
		);
		if (!stableText || (!textTarget && !current.image.data.equals(observation.image.data))) {
			throw new UTMError("UTM screen content changed; observe again before selecting image coordinates");
		}
		await this.click(vm, { x: Math.floor(guest.x), y: Math.floor(guest.y) });
	}

	/** Coordinates are guest display pixels, not host-window or captured-image coordinates. */
	async click(
		vm: string,
		point: Point,
		options: { readonly button?: "left" | "right" | "middle"; readonly monitor?: number } = {},
	): Promise<void> {
		const monitor = options.monitor ?? 1;
		if (
			!Number.isSafeInteger(point.x) ||
			!Number.isSafeInteger(point.y) ||
			point.x < 0 ||
			point.y < 0 ||
			!Number.isSafeInteger(monitor) ||
			monitor < 1
		) {
			throw new UTMError("UTM click requires nonnegative integer guest pixels and a positive monitor index");
		}
		await this.mutate(
			vm,
			`u.inputMouseClick(v, {at:[${point.x},${point.y}],to:${monitor},withMouseButton:${JSON.stringify(options.button ?? "left")}});`,
			true,
		);
		this.cursors.set(vm, point);
	}

	/** Captures the exact VM window, including its host chrome; never falls back to another window. */
	async screenshot(vm: string): Promise<ScreenshotResult> {
		const id = await this.windowId(vm);
		const { captureWindowPng, screenCaptureAllowed } = await import("./macos-ffi/screenshot.js");
		const { readImagePixelSize } = await import("./macos-ffi/vision.js");
		if (!screenCaptureAllowed()) throw new UTMError("Screen Recording permission is required for UTM screenshots");
		const { data } = captureWindowPng(id, 4096, 4096);
		return { data, mimeType: "image/png", ...readImagePixelSize(data) };
	}

	private async windowId(vm: string): Promise<number> {
		const id = Number(
			await this.script(
				`${this.select(vm)}
if (v.status() !== "started") throw Error("Virtual machine is not running");
if (u.virtualMachines().filter(other => other.name() === v.name()).length !== 1) throw Error("VM window name is ambiguous; give virtual machines unique names");
const windows = u.windows().filter(w => w.name() === v.name());
if (windows.length !== 1) throw Error("Expected exactly one open window named for the virtual machine");
return String(windows[0].id());`,
			),
		);
		if (!Number.isSafeInteger(id) || id <= 0) throw new UTMError("Invalid UTM window identifier");
		return id;
	}

	private select(vm: string): string {
		if (vm.length === 0) throw new UTMError("A virtual machine UUID or exact name is required");
		return `const matches = u.virtualMachines().filter(v => v.id() === ${JSON.stringify(vm)} || v.name() === ${JSON.stringify(vm)});
if (matches.length !== 1) throw Error("Expected exactly one virtual machine matching the UUID or exact name");
const v = matches[0];`;
	}

	private async mutate(vm: string, action: string, input: boolean): Promise<void> {
		this.assertMayContinue();
		const script = `${this.select(vm)}
${input ? 'if (v.backend() !== "qemu" || v.status() !== "started") throw Error("Input requires a running QEMU virtual machine");' : ""}
${action}`;
		await this.script(script);
	}

	private assertMayContinue(): void {
		assertInputMayContinue(currentInputScope());
		const status = this.stopSwitch.status();
		if (status.stopped) throw new UTMError(describeUserStop(status));
	}

	private async script(body: string): Promise<string> {
		const source = `function run() { const u = Application(${JSON.stringify(this.appPath)}); ${body} }`;
		const result = await execute("/usr/bin/osascript", ["-l", "JavaScript", "-e", source], {
			timeout: 30_000,
			maxBuffer: 4 * 1024 * 1024,
		});
		return execFileStdout(result).trim();
	}
}

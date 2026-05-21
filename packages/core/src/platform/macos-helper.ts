import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AXTreeElement, AppInfo, AppState } from "../accessibility/types.js";
import type { DragOptions, KeyOptions, Point } from "../types/index.js";

const MAX_REQUEST_RETRIES = 3;

export type HelperError =
	| { kind: "not_available"; binaryPath: string; message: string }
	| { kind: "helper"; message: string }
	| { kind: "protocol"; message: string }
	| { kind: "process_exit"; code: number | null; signal: NodeJS.Signals | null; message: string }
	| { kind: "write_failed"; message: string };

type HelperMouseButton = "left" | "right" | "middle";

type HelperCommand =
	| "click"
	| "right_click"
	| "middle_click"
	| "double_click"
	| "move"
	| "drag"
	| "key"
	| "type_text"
	| "cursor_position"
	| "screen_size_logical"
	| "ping"
	| "screenshot"
	| "getAppState"
	| "listApps"
	| "setValue"
	| "performAction";

type HelperRequestPayload = {
	readonly cmd: HelperCommand;
	readonly pid?: number;
	readonly x?: number;
	readonly y?: number;
	readonly fromX?: number;
	readonly fromY?: number;
	readonly toX?: number;
	readonly toY?: number;
	readonly button?: HelperMouseButton;
	readonly count?: number;
	readonly modifiers?: readonly string[];
	readonly key?: string;
	readonly text?: string;
	readonly duration?: number;
	readonly steps?: number;
	readonly width?: number;
	readonly height?: number;
	readonly elementIndex?: number;
	readonly targetValue?: string;
	readonly action?: string;
	readonly settleMs?: number;
	readonly timeoutMs?: number;
	readonly pollMs?: number;
};

type HelperSuccessResponse = {
	readonly id: string;
	readonly ok: true;
	readonly x?: number | undefined;
	readonly y?: number | undefined;
	readonly version?: string | undefined;
	readonly data?: string | undefined;
	readonly width?: number | undefined;
	readonly height?: number | undefined;
	readonly elements?: readonly unknown[] | undefined;
	readonly axAvailable?: boolean | undefined;
	readonly app?: string | undefined;
	readonly bundleId?: string | undefined;
	readonly pid?: number | undefined;
	readonly frontmost?: boolean | undefined;
	readonly apps?: readonly unknown[] | undefined;
	readonly settled?: boolean | undefined;
};

type HelperFailureResponse = {
	readonly id: string;
	readonly ok: false;
	readonly error: string;
};

type HelperResponse = HelperSuccessResponse | HelperFailureResponse;

type PendingRequest = {
	readonly resolve: (response: HelperSuccessResponse) => void;
	readonly reject: (error: MacOSCuaHelperError) => void;
};

export class MacOSCuaHelperError extends Error {
	readonly helperError: HelperError;

	constructor(helperError: HelperError) {
		super(helperError.message);
		this.name = "MacOSCuaHelperError";
		this.helperError = helperError;
	}
}

export class HelperNotAvailableError extends MacOSCuaHelperError {
	constructor(binaryPath: string) {
		super({
			kind: "not_available",
			binaryPath,
			message: `macos-cua helper binary not found at ${binaryPath}. Build it with pnpm --filter @macos-cua/core build or bash packages/cua-helper/build.sh.`,
		});
		this.name = "HelperNotAvailableError";
	}
}

export type MacOSCuaHelperOptions = {
	readonly binaryPath?: string;
};

const HELPER_BINARY_NAME = "cua-helper";
const ENV_OVERRIDE_KEY = "MACOS_CUA_HELPER_PATH";

export function resolveHelperBinaryPath(): string {
	const override = process.env[ENV_OVERRIDE_KEY];
	if (override !== undefined && override.length > 0) {
		return override;
	}
	const moduleDir = import.meta.dirname;
	const distributedFromCompiled = join(moduleDir, "..", "bin", HELPER_BINARY_NAME);
	const distributedFromSource = join(moduleDir, "..", "..", "dist", "bin", HELPER_BINARY_NAME);
	const monorepoBuildFromSource = join(
		moduleDir,
		"..",
		"..",
		"..",
		"cua-helper",
		".build",
		"release",
		HELPER_BINARY_NAME,
	);
	const monorepoBuildFromCompiled = join(
		moduleDir,
		"..",
		"..",
		"..",
		"..",
		"cua-helper",
		".build",
		"release",
		HELPER_BINARY_NAME,
	);
	const candidates = [
		distributedFromCompiled,
		distributedFromSource,
		monorepoBuildFromSource,
		monorepoBuildFromCompiled,
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return distributedFromCompiled;
}

export class MacOSCuaHelper {
	private readonly binaryPath: string;
	private child: ChildProcessWithoutNullStreams | undefined;
	private stdoutBuffer = "";
	private closing = false;
	private readonly pendingRequests = new Map<string, PendingRequest>();

	static isAvailable(binaryPath: string = resolveHelperBinaryPath()): boolean {
		return existsSync(binaryPath);
	}

	constructor(options: MacOSCuaHelperOptions = {}) {
		this.binaryPath = options.binaryPath ?? resolveHelperBinaryPath();
		process.once("exit", () => this.close());
	}

	get binary(): string {
		return this.binaryPath;
	}

	async clickPid(pid: number, position: Point): Promise<void> {
		await this.request({
			cmd: "click",
			pid,
			x: position.x,
			y: position.y,
			button: "left",
			count: 1,
			modifiers: [],
		});
	}

	async rightClickPid(pid: number, position: Point): Promise<void> {
		await this.request({ cmd: "right_click", pid, x: position.x, y: position.y, modifiers: [] });
	}

	async middleClickPid(pid: number, position: Point): Promise<void> {
		await this.request({ cmd: "middle_click", pid, x: position.x, y: position.y, modifiers: [] });
	}

	async doubleClickPid(pid: number, position: Point): Promise<void> {
		await this.request({ cmd: "double_click", pid, x: position.x, y: position.y, modifiers: [] });
	}

	async movePid(pid: number, position: Point): Promise<void> {
		await this.request({ cmd: "move", pid, x: position.x, y: position.y });
	}

	async dragPid(pid: number, options: DragOptions): Promise<void> {
		await this.request({
			cmd: "drag",
			pid,
			fromX: options.from.x,
			fromY: options.from.y,
			toX: options.to.x,
			toY: options.to.y,
			...(options.duration === undefined ? {} : { duration: Math.trunc(options.duration) }),
		});
	}

	async keyPid(pid: number, key: string, options?: KeyOptions): Promise<void> {
		await this.request({ cmd: "key", pid, key, modifiers: options?.modifiers ?? [] });
	}

	async typeTextPid(pid: number, text: string): Promise<void> {
		await this.request({ cmd: "type_text", pid, text });
	}

	async cursorPosition(): Promise<Point> {
		const response = await this.request({ cmd: "cursor_position" });
		if (response.x === undefined || response.y === undefined) {
			throw new MacOSCuaHelperError({ kind: "protocol", message: "cursor_position response missing x/y" });
		}
		return { x: Math.round(response.x), y: Math.round(response.y) };
	}

	async getLogicalScreenSize(): Promise<{ width: number; height: number }> {
		const response = await this.request({ cmd: "screen_size_logical" });
		if (response.x === undefined || response.y === undefined) {
			throw new MacOSCuaHelperError({ kind: "protocol", message: "screen_size_logical response missing x/y" });
		}
		return { width: Math.round(response.x), height: Math.round(response.y) };
	}

	async ping(): Promise<void> {
		await this.request({ cmd: "ping" });
	}

	async screenshot(width: number, height: number): Promise<{ data: string; width: number; height: number }> {
		try {
			const response = await this.request({ cmd: "screenshot", width, height });
			if (
				typeof response.data !== "string" ||
				typeof response.width !== "number" ||
				typeof response.height !== "number"
			) {
				throw new Error("response missing data, width, or height");
			}
			return { data: response.data, width: response.width, height: response.height };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`cua-helper screenshot failed: ${message}`);
		}
	}

	async getAppState(pid: number | undefined, width: number, height: number): Promise<AppState> {
		try {
			const response =
				pid === undefined
					? await this.request({ cmd: "getAppState", width, height })
					: await this.request({ cmd: "getAppState", pid, width, height });
			if (
				typeof response.data !== "string" ||
				typeof response.width !== "number" ||
				typeof response.height !== "number" ||
				!Array.isArray(response.elements) ||
				typeof response.axAvailable !== "boolean" ||
				typeof response.app !== "string" ||
				typeof response.bundleId !== "string" ||
				typeof response.pid !== "number" ||
				typeof response.frontmost !== "boolean"
			) {
				throw new Error("response missing required fields");
			}
			if (!response.elements.every(isAXTreeElement)) {
				throw new Error("invalid elements array");
			}
			return {
				app: response.app,
				bundleId: response.bundleId,
				pid: response.pid,
				frontmost: response.frontmost,
				axAvailable: response.axAvailable,
				elements: response.elements,
				screenshotBase64: response.data,
				screenshotWidth: response.width,
				screenshotHeight: response.height,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`cua-helper getAppState failed: ${message}`);
		}
	}

	async listApps(): Promise<AppInfo[]> {
		try {
			const response = await this.request({ cmd: "listApps" });
			if (!Array.isArray(response.apps)) {
				throw new Error("response missing apps array");
			}
			if (!response.apps.every(isAppInfoJSON)) {
				throw new Error("invalid apps array");
			}
			return response.apps.map((app) => ({
				name: app.name,
				bundleId: app.bundleId,
				pid: app.pid,
				isRunning: true,
			}));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`cua-helper listApps failed: ${message}`);
		}
	}

	async setValue(pid: number, elementIndex: number, value: string): Promise<void> {
		try {
			await this.request({ cmd: "setValue", pid, elementIndex, targetValue: value });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`cua-helper setValue failed: ${message}`);
		}
	}

	async performAction(pid: number, elementIndex: number, action: string): Promise<void> {
		try {
			await this.request({ cmd: "performAction", pid, elementIndex, action });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`cua-helper performAction failed: ${message}`);
		}
	}

	close(): void {
		this.closing = true;
		const child = this.child;
		this.child = undefined;
		if (child !== undefined && !child.killed) {
			child.kill("SIGTERM");
		}
	}

	private async request(payload: HelperRequestPayload): Promise<HelperSuccessResponse> {
		let attempt = 0;
		while (true) {
			try {
				const response = await this.sendOnce(payload);
				return response;
			} catch (error) {
				if (
					error instanceof MacOSCuaHelperError &&
					shouldRetry(error.helperError) &&
					attempt < MAX_REQUEST_RETRIES
				) {
					attempt += 1;
					continue;
				}
				throw error;
			}
		}
	}

	private sendOnce(payload: HelperRequestPayload): Promise<HelperSuccessResponse> {
		const child = this.ensureChild();
		const id = randomUUID();
		const line = `${JSON.stringify({ id, ...payload })}
`;
		return new Promise<HelperSuccessResponse>((resolve, reject) => {
			this.pendingRequests.set(id, { resolve, reject });
			child.stdin.write(line, (error) => {
				if (error === null || error === undefined) {
					return;
				}
				this.pendingRequests.delete(id);
				reject(new MacOSCuaHelperError({ kind: "write_failed", message: error.message }));
			});
		});
	}

	private ensureChild(): ChildProcessWithoutNullStreams {
		if (this.child !== undefined) {
			return this.child;
		}
		if (!existsSync(this.binaryPath)) {
			throw new HelperNotAvailableError(this.binaryPath);
		}
		this.closing = false;
		const child = spawn(this.binaryPath, [], { stdio: "pipe" });
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => this.handleStdout(chunk));
		child.stderr.on("data", (chunk: string) => process.stderr.write(`[cua-helper] ${chunk}`));
		child.on("close", (code, signal) => this.handleClose(code, signal));
		this.child = child;
		return child;
	}

	private handleStdout(chunk: string): void {
		this.stdoutBuffer += chunk;
		while (true) {
			const newlineIndex = this.stdoutBuffer.indexOf("\n");
			if (newlineIndex === -1) {
				return;
			}
			const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
			this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
			if (line.length > 0) {
				this.handleResponseLine(line);
			}
		}
	}

	private handleResponseLine(line: string): void {
		let response: HelperResponse;
		try {
			response = parseResponse(line);
		} catch (error) {
			this.rejectAll(new MacOSCuaHelperError({ kind: "protocol", message: errorMessage(error) }));
			return;
		}

		const pending = this.pendingRequests.get(response.id);
		if (pending === undefined) {
			return;
		}
		this.pendingRequests.delete(response.id);
		if (response.ok) {
			pending.resolve(response);
			return;
		}
		pending.reject(new MacOSCuaHelperError({ kind: "helper", message: response.error }));
	}

	private handleClose(code: number | null, signal: NodeJS.Signals | null): void {
		this.child = undefined;
		this.stdoutBuffer = "";
		if (this.closing) {
			return;
		}
		this.rejectAll(
			new MacOSCuaHelperError({
				kind: "process_exit",
				code,
				signal,
				message: `cua-helper exited before replying (code=${String(code)}, signal=${String(signal)})`,
			}),
		);
	}

	private rejectAll(error: MacOSCuaHelperError): void {
		for (const pending of this.pendingRequests.values()) {
			pending.reject(error);
		}
		this.pendingRequests.clear();
	}
}

function shouldRetry(error: HelperError): boolean {
	return error.kind === "process_exit" || error.kind === "write_failed";
}

function parseResponse(line: string): HelperResponse {
	const parsed: unknown = JSON.parse(line);
	if (!isRecord(parsed) || typeof parsed["id"] !== "string" || typeof parsed["ok"] !== "boolean") {
		throw new Error("helper response must contain string id and boolean ok");
	}
	const id = parsed["id"];
	if (!parsed["ok"]) {
		const errorField = parsed["error"];
		return { id, ok: false, error: typeof errorField === "string" ? errorField : "unknown helper error" };
	}
	return {
		id,
		ok: true,
		x: typeof parsed["x"] === "number" ? parsed["x"] : undefined,
		y: typeof parsed["y"] === "number" ? parsed["y"] : undefined,
		version: typeof parsed["version"] === "string" ? parsed["version"] : undefined,
		data: typeof parsed["data"] === "string" ? parsed["data"] : undefined,
		width: typeof parsed["width"] === "number" ? parsed["width"] : undefined,
		height: typeof parsed["height"] === "number" ? parsed["height"] : undefined,
		elements: Array.isArray(parsed["elements"]) ? parsed["elements"] : undefined,
		axAvailable: typeof parsed["axAvailable"] === "boolean" ? parsed["axAvailable"] : undefined,
		app: typeof parsed["app"] === "string" ? parsed["app"] : undefined,
		bundleId: typeof parsed["bundleId"] === "string" ? parsed["bundleId"] : undefined,
		pid: typeof parsed["pid"] === "number" ? parsed["pid"] : undefined,
		frontmost: typeof parsed["frontmost"] === "boolean" ? parsed["frontmost"] : undefined,
		apps: Array.isArray(parsed["apps"]) ? parsed["apps"] : undefined,
		settled: typeof parsed["settled"] === "boolean" ? parsed["settled"] : undefined,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isAXTreeElement(value: unknown): value is AXTreeElement {
	if (!isRecord(value)) {
		return false;
	}
	const frame = value["frame"];
	if (!isRecord(frame)) {
		return false;
	}
	const actions = value["actions"];
	const children = value["children"];
	return (
		typeof value["id"] === "number" &&
		typeof value["role"] === "string" &&
		(value["label"] === null || typeof value["label"] === "string") &&
		(value["value"] === null || typeof value["value"] === "string") &&
		typeof frame["x"] === "number" &&
		typeof frame["y"] === "number" &&
		typeof frame["width"] === "number" &&
		typeof frame["height"] === "number" &&
		Array.isArray(actions) &&
		actions.every((a): a is string => typeof a === "string") &&
		Array.isArray(children) &&
		children.every((c): c is number => typeof c === "number")
	);
}

function isAppInfoJSON(
	value: unknown,
): value is { readonly name: string; readonly bundleId: string; readonly pid: number; readonly isActive: boolean } {
	if (!isRecord(value)) {
		return false;
	}
	return (
		typeof value["name"] === "string" &&
		typeof value["bundleId"] === "string" &&
		typeof value["pid"] === "number" &&
		typeof value["isActive"] === "boolean"
	);
}

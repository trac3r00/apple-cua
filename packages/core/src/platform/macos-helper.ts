import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
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
	| "ping";

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
};

type HelperSuccessResponse = {
	readonly id: string;
	readonly ok: true;
	readonly x?: number;
	readonly y?: number;
	readonly version?: string;
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
		await this.request({ cmd: "click", pid, x: position.x, y: position.y, button: "left", count: 1, modifiers: [] });
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

	async ping(): Promise<void> {
		await this.request({ cmd: "ping" });
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
		const line = `${JSON.stringify({ id, ...payload })}\n`;
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
	const x = parsed["x"];
	const y = parsed["y"];
	const version = parsed["version"];
	return {
		id,
		ok: true,
		...(typeof x === "number" ? { x } : {}),
		...(typeof y === "number" ? { y } : {}),
		...(typeof version === "string" ? { version } : {}),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

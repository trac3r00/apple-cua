import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
	type CallToolResult,
	CallToolResultSchema,
	type Progress,
	type Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { DOCTOR_HINT, type ServerLaunch } from "./launcher.js";

/** One live connection to apple-cua-mcp. */
export interface ServerConnection {
	readonly client: Client;
	/** The end of what the server wrote to stderr, quoted when it fails. */
	readonly stderrTail: () => string;
}

/** Opens a fresh connection: the signed helper over stdio in production, an in-memory server in tests. */
export type ConnectServer = () => Promise<ServerConnection>;

export interface CallOptions {
	readonly signal?: AbortSignal | undefined;
	readonly onProgress?: ((message: string) => void) | undefined;
}

export type ToolResultListener = (
	name: string,
	args: Readonly<Record<string, unknown>>,
	result: CallToolResult,
) => void;

export interface BridgeStart {
	readonly tools: readonly Tool[];
	readonly instructions: string | undefined;
}

export const CLIENT_INFO = { name: "apple-cua-pi-extension", version: "0.1.0" } as const;

/** Long enough for the slowest single guarded call (open_app waits up to 30 s); progress notifications restart it. */
const CALL_TIMEOUT_MILLISECONDS = 120_000;
const STDERR_TAIL_CHARACTERS = 4_000;
const STDERR_TAIL_LINES = 5;

/**
 * One apple-cua-mcp server per pi session. A server that exits on its own is restarted once; after a second exit
 * every call fails with an error naming `apple-cua doctor`. A call in flight when the server exits fails and is
 * never replayed, because its input may already have been dispatched.
 */
export class McpBridge {
	private connection: Promise<ServerConnection> | undefined;
	private live: ServerConnection | undefined;
	private restartsLeft: number;
	private closed = false;
	private failure: Error | undefined;
	private readonly resultListeners: ToolResultListener[] = [];
	private readonly exitListeners: (() => void)[] = [];

	constructor(
		private readonly connect: ConnectServer,
		restarts = 1,
	) {
		this.restartsLeft = restarts;
	}

	/** Called with every tools/call answer. */
	onToolResult(listener: ToolResultListener): void {
		this.resultListeners.push(listener);
	}

	/** Called when the server exits on its own; its observation tokens die with it. */
	onServerExit(listener: () => void): void {
		this.exitListeners.push(listener);
	}

	/** Starts the server and reads its tools and instructions. */
	async start(): Promise<BridgeStart> {
		const connection = await this.open();
		try {
			return { tools: await listAllTools(connection.client), instructions: connection.client.getInstructions() };
		} catch (error) {
			await this.close();
			throw new Error(
				`apple-cua: apple-cua-mcp started but did not list its tools: ${errorMessage(error)}${stderrNote(connection.stderrTail())}. ${DOCTOR_HINT}`,
			);
		}
	}

	async callTool(
		name: string,
		args: Readonly<Record<string, unknown>>,
		options: CallOptions = {},
	): Promise<CallToolResult> {
		const connection = await this.ready();
		const { signal, onProgress } = options;
		let result: CallToolResult;
		try {
			result = await connection.client.request(
				{ method: "tools/call", params: { name, arguments: { ...args } } },
				CallToolResultSchema,
				{
					timeout: CALL_TIMEOUT_MILLISECONDS,
					resetTimeoutOnProgress: true,
					...(signal === undefined ? {} : { signal }),
					...(onProgress === undefined ? {} : { onprogress: (progress) => onProgress(progressMessage(progress)) }),
				},
			);
		} catch (error) {
			if (!this.closed && this.live !== connection) {
				const next = this.failure?.message ?? "It is being restarted for the next call.";
				throw new Error(
					`apple-cua: apple-cua-mcp exited while running ${name}${stderrNote(connection.stderrTail())}. The action may or may not have been dispatched: observe the app again before retrying. ${next}`,
				);
			}
			throw error;
		}
		for (const listener of this.resultListeners) {
			listener(name, args, result);
		}
		return result;
	}

	/** Stops the server for good (session end); a close is never treated as a crash. */
	async close(): Promise<void> {
		if (this.closed) {
			return;
		}
		this.closed = true;
		const pending = this.connection;
		this.connection = undefined;
		this.live = undefined;
		const connection = await pending?.catch(() => undefined);
		await connection?.client.close();
	}

	private open(): Promise<ServerConnection> {
		const opening = this.connect().then(async (connection) => {
			if (this.closed) {
				await connection.client.close();
				throw new Error("apple-cua: the pi session ended while apple-cua-mcp was starting");
			}
			this.live = connection;
			connection.client.onclose = () => this.serverClosed(connection);
			return connection;
		});
		this.connection = opening;
		return opening;
	}

	private serverClosed(connection: ServerConnection): void {
		if (this.closed || this.live !== connection) {
			return;
		}
		this.live = undefined;
		for (const listener of this.exitListeners) {
			listener();
		}
		const stderr = stderrNote(connection.stderrTail());
		if (this.restartsLeft <= 0) {
			this.connection = undefined;
			this.failure = new Error(
				`apple-cua: apple-cua-mcp exited again after its one restart${stderr}. ${DOCTOR_HINT} Then start a new pi session.`,
			);
			return;
		}
		this.restartsLeft -= 1;
		this.open().catch((error: unknown) => {
			this.failure = new Error(
				`apple-cua: apple-cua-mcp exited${stderr} and could not be restarted: ${errorMessage(error)}. ${DOCTOR_HINT}`,
			);
		});
	}

	private async ready(): Promise<ServerConnection> {
		if (this.closed) {
			throw new Error("apple-cua: the apple-cua-mcp connection is closed because the pi session ended.");
		}
		if (this.failure !== undefined) {
			throw this.failure;
		}
		if (this.connection === undefined) {
			throw new Error("apple-cua: apple-cua-mcp has not been started in this pi session.");
		}
		try {
			return await this.connection;
		} catch (error) {
			throw this.failure ?? error;
		}
	}
}

/** Spawns the server through its launcher and completes the MCP handshake. */
export async function connectStdio(launch: ServerLaunch): Promise<ServerConnection> {
	const transport = new StdioClientTransport({
		command: launch.command,
		args: [...launch.args],
		env: { ...launch.env },
		// Piped, never inherited: pi draws a terminal UI that the server's diagnostics must not write over.
		stderr: "pipe",
	});
	let stderr = "";
	transport.stderr?.on("data", (chunk: unknown) => {
		stderr = `${stderr}${String(chunk)}`.slice(-STDERR_TAIL_CHARACTERS);
	});
	const client = new Client(CLIENT_INFO);
	try {
		await client.connect(transport);
	} catch (error) {
		await transport.close();
		throw new Error(
			`apple-cua: could not start ${[launch.command, ...launch.args].join(" ")}: ${errorMessage(error)}${stderrNote(stderr)}. ${DOCTOR_HINT}`,
		);
	}
	return { client, stderrTail: () => stderr.trim() };
}

async function listAllTools(client: Client): Promise<Tool[]> {
	const tools: Tool[] = [];
	let cursor: string | undefined;
	do {
		const page = await client.listTools(cursor === undefined ? undefined : { cursor });
		tools.push(...page.tools);
		cursor = page.nextCursor;
	} while (cursor !== undefined);
	return tools;
}

function progressMessage(progress: Progress): string {
	if (progress.message !== undefined) {
		return progress.message;
	}
	return progress.total === undefined ? `${progress.progress}` : `${progress.progress}/${progress.total}`;
}

function stderrNote(stderr: string): string {
	const lines = stderr.trim().split("\n").slice(-STDERR_TAIL_LINES).join("\n");
	return lines === "" ? "" : ` (its last output: ${lines})`;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

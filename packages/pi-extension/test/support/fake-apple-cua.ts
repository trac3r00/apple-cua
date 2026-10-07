import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
	CallToolRequestSchema,
	type CallToolResult,
	ListToolsRequestSchema,
	type Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { CLIENT_INFO, type ConnectServer } from "../../src/mcp-bridge.js";

export interface RecordedCall {
	readonly name: string;
	readonly args: Readonly<Record<string, unknown>>;
}

export type ToolHandler = (args: Readonly<Record<string, unknown>>) => CallToolResult | Promise<CallToolResult>;

const DRAFT_07 = "http://json-schema.org/draft-07/schema#";

function tool(name: string, properties: Record<string, object>, required: string[] = []): Tool {
	return {
		name,
		description: `apple-cua ${name}`,
		inputSchema: { type: "object", properties, required, $schema: DRAFT_07 },
	};
}

const app = { type: "string", minLength: 1 };
const token = { type: "string", minLength: 1 };
const coordinate = { type: "number" };

/** Tools shaped like apple-cua-mcp's: JSON Schema draft-07 input schemas carrying a $schema marker. */
export const FAKE_TOOLS: readonly Tool[] = [
	tool("list_apps", {}),
	tool(
		"get_app_state",
		{ app, element_format: { type: "string", enum: ["json", "table"] }, include_screenshot: { type: "boolean" } },
		["app"],
	),
	tool(
		"click",
		{
			app,
			observation_token: token,
			x: coordinate,
			y: coordinate,
			click_count: { type: "integer" },
			mouse_button: { type: "string", enum: ["left", "right", "middle"] },
			modifiers: { type: "array", items: { type: "string" } },
		},
		["app", "observation_token"],
	),
	tool(
		"drag",
		{ app, observation_token: token, from_x: coordinate, from_y: coordinate, to_x: coordinate, to_y: coordinate },
		["app", "observation_token", "from_x", "from_y", "to_x", "to_y"],
	),
	tool("type_text", { app, observation_token: token, text: { type: "string" } }, ["app", "observation_token", "text"]),
	tool("press_keys", { app, observation_token: token, keys: { type: "array" } }, ["app", "observation_token", "keys"]),
];

export function textAnswer(payload: unknown): CallToolResult {
	return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

/**
 * An in-memory stand-in for apple-cua-mcp: real MCP protocol over a linked transport pair, scripted tool answers,
 * every call recorded. Each connect is a fresh server, like a respawned process.
 */
export class FakeAppleCuaServer {
	readonly calls: RecordedCall[] = [];
	connections = 0;
	closedConnections = 0;
	stderr = "";
	private readonly handlers = new Map<string, ToolHandler>();
	private readonly transports: InMemoryTransport[] = [];

	constructor(
		readonly tools: readonly Tool[] = FAKE_TOOLS,
		readonly instructions?: string,
	) {}

	handle(name: string, handler: ToolHandler): this {
		this.handlers.set(name, handler);
		return this;
	}

	callsTo(name: string): RecordedCall[] {
		return this.calls.filter((call) => call.name === name);
	}

	readonly connect: ConnectServer = async () => {
		this.connections += 1;
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		const server = new Server(
			{ name: "apple-cua", version: "0.1.0" },
			{
				capabilities: { tools: {} },
				...(this.instructions === undefined ? {} : { instructions: this.instructions }),
			},
		);
		server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...this.tools] }));
		server.setRequestHandler(CallToolRequestSchema, async (request) => {
			const args = request.params.arguments ?? {};
			this.calls.push({ name: request.params.name, args });
			const handler = this.handlers.get(request.params.name);
			return handler === undefined
				? { isError: true, content: [{ type: "text", text: `no handler for ${request.params.name}` }] }
				: await handler(args);
		});
		let closed = false;
		server.onclose = () => {
			if (!closed) {
				closed = true;
				this.closedConnections += 1;
			}
		};
		await server.connect(serverTransport);
		this.transports.push(serverTransport);
		const client = new Client(CLIENT_INFO);
		await client.connect(clientTransport);
		return { client, stderrTail: () => this.stderr };
	};

	/** The latest server process exits on its own. */
	async exit(): Promise<void> {
		await this.transports.at(-1)?.close();
	}
}

export interface GuardedWindowOptions {
	readonly width?: number;
	readonly height?: number;
	readonly instructions?: string;
}

/**
 * A fake that guards like apple-cua-mcp: get_app_state issues a one-use token with a window screenshot, each
 * mutation needs the newest token and answers with the next one, and a stale token is refused.
 */
export function guardedWindowServer(options: GuardedWindowOptions = {}): FakeAppleCuaServer {
	let issued = 0;
	let current: string | undefined;
	const issue = () => {
		issued += 1;
		current = `token-${issued}`;
		return current;
	};
	const fake = new FakeAppleCuaServer(FAKE_TOOLS, options.instructions);
	fake.handle("get_app_state", (args) => ({
		content: [
			{ type: "image", data: "d2luZG93", mimeType: "image/jpeg" },
			{
				type: "text",
				text: JSON.stringify({
					app: args["app"],
					bundleId: "com.example.Notes",
					windowTitle: "Draft",
					screenshotWidth: options.width ?? 1600,
					screenshotHeight: options.height ?? 1000,
					element_columns: "id\trole",
					element_rows: ["0\tWindow"],
					observation_token: issue(),
				}),
			},
		],
	}));
	const mutation: ToolHandler = (args) => {
		if (args["observation_token"] !== current) {
			return {
				isError: true,
				content: [{ type: "text", text: JSON.stringify({ reason: "stale-observation-token" }) }],
			};
		}
		return textAnswer({ actionDispatched: true, effect: "observed_change", observation_token: issue() });
	};
	for (const name of ["click", "drag", "type_text", "press_keys"]) {
		fake.handle(name, mutation);
	}
	return fake;
}

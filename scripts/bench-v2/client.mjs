import { spawn } from "node:child_process";

export class McpClient {
	constructor({ command, args, env, timeoutMs = 30000 }) {
		this.command = command;
		this.args = args;
		this.env = env;
		this.timeoutMs = timeoutMs;
		this.nextId = 1;
		this.pending = new Map();
		this.dead = null;
		this.stderr = "";
	}
	async start() {
		this.child = spawn(this.command, this.args, {
			env: { ...process.env, ...this.env },
			stdio: ["pipe", "pipe", "pipe"],
		});
		let buffer = "";
		this.child.stdout.on("data", (chunk) => {
			buffer += chunk.toString();
			let index = buffer.indexOf("\n");
			while (index >= 0) {
				const line = buffer.slice(0, index);
				buffer = buffer.slice(index + 1);
				try {
					const message = JSON.parse(line);
					const pending = this.pending.get(message.id);
					if (pending) {
						clearTimeout(pending.timer);
						this.pending.delete(message.id);
						if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
						else pending.resolve(message.result);
					}
				} catch (error) {
					if (!(error instanceof SyntaxError)) throw error;
					died(`protocol-error: invalid JSON-RPC stdout: ${line.slice(0, 120)}`);
					this.child.kill();
					return;
				}
				index = buffer.indexOf("\n");
			}
		});
		this.child.stderr.on("data", (chunk) => {
			this.stderr = (this.stderr + chunk.toString()).slice(-4096);
		});
		const died = (reason) => {
			this.dead = reason;
			for (const pending of this.pending.values()) {
				clearTimeout(pending.timer);
				pending.reject(new Error(reason));
			}
			this.pending.clear();
		};
		this.child.on("error", (error) => died(`server-exit: ${error.message}`));
		this.child.on("exit", (code, signal) => died(`server-exit: ${code ?? signal}; ${this.stderr}`));
		await this.request("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "bench-v2", version: "1" },
		});
		this.child.stdin.write(
			`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`,
		);
	}
	request(method, params) {
		if (this.dead) return Promise.reject(new Error(this.dead));
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`timeout: ${method} after ${this.timeoutMs}ms`));
			}, this.timeoutMs);
			this.pending.set(id, { resolve, reject, timer });
			this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`, (error) => {
				if (error && this.pending.has(id)) {
					clearTimeout(timer);
					this.pending.delete(id);
					reject(error);
				}
			});
		});
	}
	callTool(name, args) {
		return this.request("tools/call", { name, arguments: args });
	}
	stop() {
		this.child?.kill();
	}
}

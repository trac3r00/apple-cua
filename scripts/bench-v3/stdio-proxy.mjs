import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";

// Transparent bench-owned logging boundary. No commands, permissions or results are rewritten.
const [log, command, ...args] = process.argv.slice(2);
if (!log || !command) throw new Error("usage: stdio-proxy <log> <command> [args]");
const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
const pending = new Map();
let requestBuffer = "";
let responseBuffer = "";
const record = (row) => appendFileSync(log, `${JSON.stringify(row)}\n`);
process.stdin.on("data", (chunk) => {
	requestBuffer += chunk.toString();
	let index = requestBuffer.indexOf("\n");
	while (index >= 0) {
		const line = requestBuffer.slice(0, index);
		requestBuffer = requestBuffer.slice(index + 1);
		try {
			const request = JSON.parse(line);
			if (request.method === "tools/call") {
				pending.set(request.id, performance.now());
				record({
					direction: "request",
					id: request.id,
					tool: request.params?.name,
					arguments: request.params?.arguments,
				});
			}
		} catch {
			record({ direction: "request", malformed_frame: true });
		}
		index = requestBuffer.indexOf("\n");
	}
	child.stdin.write(chunk);
});
process.stdin.on("end", () => child.stdin.end());
child.stdout.on("data", (chunk) => {
	responseBuffer += chunk.toString();
	let index = responseBuffer.indexOf("\n");
	while (index >= 0) {
		const line = responseBuffer.slice(0, index);
		responseBuffer = responseBuffer.slice(index + 1);
		try {
			const response = JSON.parse(line);
			const started = pending.get(response.id);
			if (started !== undefined) {
				record({
					direction: "response",
					id: response.id,
					latency_ms: performance.now() - started,
					isError: response.result?.isError ?? Boolean(response.error),
				});
				pending.delete(response.id);
			}
		} catch {
			record({ direction: "response", malformed_frame: true });
		}
		index = responseBuffer.indexOf("\n");
	}
	process.stdout.write(chunk);
});
child.stderr.pipe(process.stderr);
child.once("error", (error) => {
	record({ error: String(error) });
	process.exitCode = 1;
});
child.once("exit", (code, signal) => {
	record({ exit: code, signal, pending: pending.size });
	process.exit(code ?? 1);
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, () => child.kill(signal));

#!/usr/bin/env node
// The process entry point. It loads only what its role needs: the supervisor that owns the client's stdio never
// loads the tool modules, so a new session reaches initialize after one load of them (in the child), not two.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PERMISSION_REQUEST_FLAG, SELF_CHECK_FLAG } from "./entry-flags.js";
import { SUPERVISED_CHILD_FLAG, nodeSupervisorOptions, startSupervisor } from "./supervisor.js";

/**
 * Serve through a supervisor that owns the client's stdio and runs the real server as a child: a crash, a rebuilt
 * server or a newly granted permission restarts the child behind the same connection, and the client is told to
 * list tools again, so no session restart is needed. OPENCUA_SUPERVISOR=off serves directly.
 */
function superviseServer(): void {
	const handle = startSupervisor(
		nodeSupervisorOptions(fileURLToPath(import.meta.url), process.argv.slice(2), SELF_CHECK_FLAG),
	);
	const exitCodes = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 } as const;
	for (const [signal, code] of Object.entries(exitCodes)) {
		process.once(signal, () => {
			process.stdin.destroy();
			void handle.done.finally(() => process.exit(code));
			process.stdin.emit("end");
		});
	}
	void handle.done.then((code) => process.exit(code));
}

/**
 * Whether this file is the process entry point. The loader resolves the module's own path through symlinks while
 * argv keeps the path as typed, so both sides are compared as real paths: a checkout under a symlinked directory
 * (/tmp is one on macOS) would otherwise never start the server.
 */
function isEntryPoint(): boolean {
	const entry = process.argv[1];
	if (entry === undefined) {
		return false;
	}
	try {
		return realpathSync(entry) === fileURLToPath(import.meta.url);
	} catch {
		return false;
	}
}

async function run(): Promise<void> {
	const requestIndex = process.argv.indexOf(PERMISSION_REQUEST_FLAG);
	if (process.argv.includes(SELF_CHECK_FLAG)) {
		const { selfCheckReport } = await import("./self-check.js");
		process.stdout.write(`${JSON.stringify(selfCheckReport())}\n`, () => process.exit(0));
	} else if (requestIndex !== -1) {
		const { parsePermissionRequests, requestPermissions } = await import("./self-check.js");
		const report = requestPermissions(parsePermissionRequests(process.argv[requestIndex + 1] ?? ""));
		process.stdout.write(`${JSON.stringify(report)}\n`, () => process.exit(0));
	} else if (!process.argv.includes(SUPERVISED_CHILD_FLAG) && process.env["OPENCUA_SUPERVISOR"] !== "off") {
		superviseServer();
	} else {
		const { main } = await import("./mcp-server.js");
		await main();
	}
}

if (isEntryPoint()) {
	run().catch((error: unknown) => {
		const details = error instanceof Error ? (error.stack ?? error.message) : String(error);
		process.stderr.write(`Fatal error: ${details}\n`);
		process.exit(1);
	});
}

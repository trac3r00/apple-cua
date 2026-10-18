import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { isScreenLocked } from "../../packages/core/dist/platform/macos-ffi/lock-screen.js";
import { McpClient } from "../bench-v2/client.mjs";
import { cancellationFixtureDirectory } from "./cancellation-fixture.mjs";
import { Driver } from "./drivers.mjs";
import { subscribeWindow } from "./window-event.mjs";

// Exploratory observer QA, not a mutation-cancellation score.
const root = fileURLToPath(new URL("../..", import.meta.url));
const dir = cancellationFixtureDirectory(mkdtempSync(join(tmpdir(), "cua-cancellation-pilot-")));
const file = join(dir, `cancel-${process.pid}.txt`);
const title = file.split("/").at(-1);
const report = { scope: "observer live QA only; no cancellation verdict", events: [], cleanup: false };
const cancelMode = process.argv.includes("--cancel");
const route = process.argv.includes("--cua") ? "cua" : "apple";
report.route = route;
if (cancelMode) report.scope = "exploratory mutation cancellation; arrival timestamps do not prove input dispatch time";
let spec = {
	command: "node",
	args: [`${root}/packages/mcp/dist/server.js`],
	env: { APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.TextEdit", APPLE_CUA_DELIVERY: "background" },
};
if (route === "cua") spec = { command: `${homedir()}/.local/bin/cua-driver`, args: ["mcp"] };
const client = new McpClient(spec);
let observer;
let mutationRequestId;
const timers = new Set();
let stopped = false;
const halt = () => {
	stopped = true;
	client.stop();
	observer?.kill();
};
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, halt);
try {
	if (isScreenLocked()) throw new Error("locked desktop");
	const windowBinary = join(dir, "window-event");
	const observerBinary = join(dir, "cancellation-events");
	execFileSync("swiftc", [`${root}/scripts/bench-v3/window-event.swift`, "-o", windowBinary], { timeout: 60000 });
	execFileSync("swiftc", [`${root}/scripts/bench-v3/cancellation-events.swift`, "-o", observerBinary], {
		timeout: 60000,
	});
	writeFileSync(file, "");
	const opened = await subscribeWindow(windowBinary, title);
	try {
		execFileSync("open", ["-g", "-e", file]);
		await opened.ready;
	} finally {
		opened.cancel();
	}
	observer = spawn(observerBinary, [file, "30"], { stdio: ["pipe", "pipe", "pipe"] });
	const exited = new Promise((resolve) => observer.once("close", resolve));
	const waiters = new Map();
	const waitFor = (type) =>
		new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(`missing ${type} event`)), 30000);
			timers.add(timer);
			waiters.set(type, (event) => {
				clearTimeout(timer);
				timers.delete(timer);
				resolve(event);
			});
		});
	const ready = waitFor("ready");
	createInterface({ input: observer.stdout }).on("line", (line) => {
		const event = JSON.parse(line);
		report.events.push(event);
		if (cancelMode && event.type === "change" && report.cancel === undefined) {
			report.cancel = {
				epoch_ms: Date.now(),
				request_id: mutationRequestId,
				request_pending: client.pending.has(mutationRequestId),
				first_value_length: event.value.length,
			};
			client.child.stdin.write(
				`${JSON.stringify({
					jsonrpc: "2.0",
					method: "notifications/cancelled",
					params: { requestId: mutationRequestId, reason: "benchmark first independently observed mutation" },
				})}\n`,
			);
		}
		waiters.get(event.type)?.(event);
	});
	observer.stderr.on("data", (chunk) => {
		report.stderr = (report.stderr ?? "") + chunk;
	});
	await ready;
	report.fixture_opened = true;
	if (stopped) throw new Error("pilot stopped");
	await client.start();
	if (stopped) throw new Error("pilot stopped");
	const driver = new Driver(route, client);
	await driver.step({ op: "observe", app: "TextEdit", title });
	const changed = waitFor("change");
	// Keep a rejected input from leaving an unhandled observer promise.
	changed.catch(() => undefined);
	const expected = cancelMode ? "cancel mutation marker ".repeat(512) : "observer mutation marker";
	mutationRequestId = client.nextId;
	try {
		await driver.step({ op: "type", app: "TextEdit", title, value: expected });
	} catch (error) {
		report.request_error = String(error);
	}
	report.response_epoch_ms = Date.now();
	if (!report.request_error) await changed;
	report.responsive = Array.isArray((await client.request("tools/list", {})).tools);
	const ended = waitFor("end");
	observer.stdin.end("stop\n");
	await ended;
	report.observer_exit = await exited;
	report.pass =
		report.observer_exit === 0 &&
		report.events.some((event) => event.type === "change" && event.value === expected) &&
		report.events.some((event) => event.type === "snapshot" && event.final && event.value === expected);
	if (cancelMode && report.cancel) {
		report.final_length = report.events.find((event) => event.type === "snapshot" && event.final)?.value.length;
		report.expected_length = expected.length;
		report.cancellation_verdict = "INCONCLUSIVE";
		report.pass = null;
		report.reason =
			report.cancel.first_value_length === expected.length
				? "Entire mutation observed before cancellation; no remaining input to cancel"
				: "Event arrival and snapshot growth retained; dispatch-time attribution requires separate evidence";
	}
} catch (error) {
	report.error = String(error);
	report.pass = false;
} finally {
	for (const timer of timers) clearTimeout(timer);
	observer?.kill();
	client.stop();
	try {
		report.cleanup_before = Number(
			execFileSync(
				"osascript",
				["-e", `tell application "TextEdit" to count (every document whose path is "${file}")`],
				{ encoding: "utf8" },
			).trim(),
		);
		if (report.fixture_opened && report.cleanup_before !== 1) {
			report.cleanup_error = "owned cleanup identity not independently established";
		} else {
			execFileSync("osascript", [
				"-e",
				`tell application "TextEdit" to close (every document whose path is "${file}") saving no`,
			]);
			const remaining = execFileSync(
				"osascript",
				["-e", `tell application "TextEdit" to count (every document whose path is "${file}")`],
				{ encoding: "utf8" },
			).trim();
			report.cleanup = remaining === "0";
		}
	} catch (error) {
		report.cleanup_error = String(error);
	}
	if (report.cleanup) rmSync(dir, { recursive: true });
}
const output = resolve(process.argv[2] ?? ".bench/v3/cancellation-observer-pilot.json");
report.interrupted = stopped;
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(
	`${JSON.stringify({ output, pass: report.pass, cleanup: report.cleanup, error: report.error })}\n`,
);

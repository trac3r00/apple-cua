#!/usr/bin/env node
/**
 * Head-to-head driver measurement: apple-cua MCP server vs Cua Driver MCP server.
 *
 * One client, one transport (MCP stdio), identical fixtures, identical call shapes.
 * Purpose: replace inference ("cua is slower because it lives in a VM") with numbers
 * for both drivers as an agent actually consumes them.
 *
 * Usage:
 *   node scripts/measure-cua-shootout.mjs --probe
 *   node scripts/measure-cua-shootout.mjs --iterations 15 --actions 10 \
 *     --out .sisyphus/evidence/driver-shootout-cua.json
 *
 * Environment is prepared by the script: a scratch TextEdit document and a Finder
 * window on the repo folder are opened, then both drivers are pointed at those
 * exact windows. Nothing is typed anywhere except the scratch document.
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const APPLE_CUA_ROOT = "/Users/bob/src/apple-cua";
const APPLE_CUA_MCP = path.join(APPLE_CUA_ROOT, "packages/mcp/dist/server.js");
const CUA_DRIVER = `${process.env.HOME}/.local/bin/cua-driver`;
const SCRATCH_DIR = "/tmp/apple-cua-shootout";
const SCRATCH_FILE = path.join(SCRATCH_DIR, "scratch.txt");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
	const index = argv.indexOf(`--${name}`);
	return index === -1 ? fallback : argv[index + 1];
};
const PROBE = argv.includes("--probe");
const TASKS = argv.includes("--tasks");
const FOREGROUND_PROBE = argv.includes("--foreground-probe");
const ITERATIONS = Number(flag("iterations", 15));
const ACTIONS = Number(flag("actions", 10));
const WARMUPS = Number(flag("warmups", 2));
const OUT = flag("out", ".sisyphus/evidence/driver-shootout-cua.json");
const TYPED_TEXT = "The quick brown fox jumps over the lazy dog. ";

/** Minimal MCP stdio client: newline-delimited JSON-RPC 2.0. */
class McpClient {
	constructor({ name, command, args, cwd, envOverrides = {}, requestTimeoutMs = 180_000 }) {
		this.name = name;
		this.command = command;
		this.args = args;
		this.cwd = cwd;
		this.envOverrides = envOverrides;
		this.requestTimeoutMs = requestTimeoutMs;
		this.nextId = 1;
		this.pending = new Map();
		this.stderrTail = [];
	}

	start() {
		const env = {
			...process.env,
			...this.envOverrides,
			PATH: `${process.env.HOME}/.local/bin:${process.env.PATH ?? ""}`,
		};
		this.child = spawn(this.command, this.args, { cwd: this.cwd, env, stdio: ["pipe", "pipe", "pipe"] });
		this.buffer = "";
		this.child.stdout.on("data", (chunk) => {
			this.buffer += chunk.toString("utf8");
			let newline = this.buffer.indexOf("\n");
			while (newline !== -1) {
				const line = this.buffer.slice(0, newline).trim();
				this.buffer = this.buffer.slice(newline + 1);
				if (line.length > 0) this.#handleLine(line);
				newline = this.buffer.indexOf("\n");
			}
		});
		this.child.stderr.on("data", (chunk) => {
			this.stderrTail.push(chunk.toString("utf8"));
			if (this.stderrTail.length > 20) this.stderrTail.shift();
		});
		return new Promise((resolve) => setTimeout(resolve, 400));
	}

	#handleLine(line) {
		let message;
		try {
			message = JSON.parse(line);
		} catch {
			return;
		}
		if (message.id !== undefined && this.pending.has(message.id)) {
			const { resolve, reject, timer } = this.pending.get(message.id);
			this.pending.delete(message.id);
			clearTimeout(timer);
			if (message.error) reject(new Error(`${this.name} error: ${JSON.stringify(message.error)}`));
			else resolve(message.result);
		}
	}

	request(method, params, timeoutMs = this.requestTimeoutMs) {
		const id = this.nextId++;
		const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`${this.name} timeout after ${timeoutMs}ms on ${method}`));
			}, timeoutMs);
			this.pending.set(id, { resolve, reject, timer });
			this.child.stdin.write(`${payload}\n`);
		});
	}

	notify(method, params) {
		this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
	}

	async initialize() {
		const result = await this.request("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "apple-cua-shootout", version: "0.1.0" },
		});
		this.notify("notifications/initialized", {});
		return result;
	}

	callTool(name, args) {
		return this.request("tools/call", { name, arguments: args });
	}

	stop() {
		try {
			this.child?.kill();
		} catch {
			// teardown race
		}
	}
}

/** Payload accounting shared by both drivers. */
function account(result) {
	const content = Array.isArray(result?.content) ? result.content : [];
	let textBytes = 0;
	let imageBytes = 0;
	let imageCount = 0;
	let imageMime = null;
	for (const block of content) {
		if (block.type === "text") textBytes += Buffer.byteLength(block.text ?? "", "utf8");
		if (block.type === "image") {
			imageBytes += Math.floor(((block.data ?? "").length * 3) / 4);
			imageCount += 1;
			imageMime = block.mimeType ?? imageMime;
		}
	}
	const structured = result?.structuredContent;
	return {
		text_bytes: textBytes,
		image_bytes: imageBytes,
		image_count: imageCount,
		image_mime: imageMime,
		structured_bytes: structured === undefined ? 0 : Buffer.byteLength(JSON.stringify(structured), "utf8"),
		response_bytes: Buffer.byteLength(JSON.stringify(result ?? null), "utf8"),
	};
}

function summarize(samples) {
	const sorted = [...samples].sort((a, b) => a - b);
	const at = (fraction) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * fraction)))] ?? 0;
	return {
		samples: sorted.length,
		p50: round(at(0.5)),
		p95: round(at(0.95)),
		min: round(sorted[0] ?? 0),
		max: round(sorted[sorted.length - 1] ?? 0),
	};
}

const round = (value) => Math.round(value * 10) / 10;

async function timed(fn) {
	const start = performance.now();
	const result = await fn();
	return { ms: performance.now() - start, result };
}

function textOf(result) {
	const block = (result?.content ?? []).find((entry) => entry.type === "text");
	return block?.text ?? "";
}

/** MCP tool errors arrive as results with isError, so latency must not be counted for them. */
function failed(result) {
	if (result?.isError === true) return true;
	const text = textOf(result);
	return text.startsWith("MCP error") || text.startsWith("Error:");
}

function frameCenter(frame) {
	const width = frame.width ?? frame.w;
	const height = frame.height ?? frame.h;
	return { x: Math.round(frame.x + width / 2), y: Math.round(frame.y + height / 2) };
}

/**
 * Cua Driver reports element frames in screen points (the AX space), while its click x/y
 * are window-local screenshot pixels. apple-cua reports window-local points, which is also
 * its click space. This converts whichever shape is present into that driver's click space.
 */
function cuaClickCenter(frame, structured) {
	const bounds = structured?.window_bounds;
	const scale = structured?.screenshot_scale ?? 1;
	const center = frameCenter(frame);
	if (bounds === undefined) return center;
	return {
		x: Math.round((center.x - bounds.x) * scale),
		y: Math.round((center.y - bounds.y) * scale),
	};
}

function activateApp(name) {
	try {
		execFileSync("osascript", ["-e", `tell application "${name}" to activate`], { stdio: "pipe", timeout: 10_000 });
	} catch {
		// activation is a fixture precondition, not a measurement
	}
}

function frontmostAppName() {
	try {
		return execFileSync(
			"osascript",
			["-e", 'tell application "System Events" to get name of first application process whose frontmost is true'],
			{ encoding: "utf8", timeout: 10_000 },
		).trim();
	} catch {
		return "unknown";
	}
}

function cursorPosition() {
	try {
		const out = execFileSync(CUA_DRIVER, ["call", "get_cursor_position", "--json"], {
			encoding: "utf8",
			timeout: 30_000,
		});
		const parsed = JSON.parse(out);
		return parsed?.structuredContent ?? parsed;
	} catch {
		return null;
	}
}

/**
 * Answers the background-delivery claim with measurements: does acting on a window that is not
 * frontmost change the frontmost app or the real cursor?
 */
async function runForegroundProbe(apple, cua, fixture) {
	const probe = { fixture: "TextEdit while Finder is frontmost" };
	const snapshot = (label) => ({
		label,
		frontmost: frontmostAppName(),
		cursor: cursorPosition(),
	});

	activateApp("Finder");
	await new Promise((resolve) => setTimeout(resolve, 1200));
	probe.before = snapshot("before");

	const cuaObs = await cua.callTool("get_window_state", {
		pid: fixture.cuaPid,
		window_id: fixture.cuaWindowId,
		include_screenshot: false,
	});
	probe.after_cua_observation = snapshot("after cua observation");

	const element = findCuaTextTarget(cuaElementsOf(cuaObs));
	if (element?.frame !== undefined) {
		const center = cuaClickCenter(element.frame, cuaObs?.structuredContent ?? {});
		const click = await cua.callTool("click", {
			pid: fixture.cuaPid,
			window_id: fixture.cuaWindowId,
			x: center.x,
			y: center.y,
		});
		probe.cua_background_click = { failed: failed(click), text: textOf(click).slice(0, 200) };
	} else {
		probe.cua_background_click = { failed: true, text: "no text target in snapshot" };
	}
	probe.after_cua_click = snapshot("after cua background click");

	const appleObs = await apple.callTool("get_app_state", { app: fixture.appleApp, include_screenshot: false });
	const appleParsed = appleObservationOf(appleObs);
	const appleElement = findTextTarget(appleElementsOf(appleObs));
	const center = appleElement?.frame === undefined ? null : frameCenter(appleElement.frame);
	const appleClick =
		center === null
			? null
			: await apple.callTool("click", {
					app: fixture.appleApp,
					observation_token: appleParsed?.observation_token,
					x: center.x,
					y: center.y,
				});
	probe.apple_click_while_background =
		appleClick === null
			? { failed: true, text: "no text target in observation" }
			: { failed: failed(appleClick), text: textOf(appleClick).slice(0, 300) };
	probe.after_apple_click = snapshot("after apple-cua click while background");

	activateApp(fixture.appleApp);
	await new Promise((resolve) => setTimeout(resolve, 1200));
	const appleObs2 = await apple.callTool("get_app_state", { app: fixture.appleApp, include_screenshot: false });
	const appleParsed2 = appleObservationOf(appleObs2);
	const appleElement2 = findTextTarget(appleElementsOf(appleObs2));
	const center2 = appleElement2?.frame === undefined ? null : frameCenter(appleElement2.frame);
	const appleClick2 =
		center2 === null
			? null
			: await apple.callTool("click", {
					app: fixture.appleApp,
					observation_token: appleParsed2?.observation_token,
					x: center2.x,
					y: center2.y,
				});
	probe.apple_click_while_frontmost =
		appleClick2 === null
			? { failed: true, text: "no text target in observation" }
			: { failed: failed(appleClick2), text: textOf(appleClick2).slice(0, 300) };
	probe.after_apple_click_frontmost = snapshot("after apple-cua click with app fronted");
	return probe;
}

function appleObservationOf(result) {
	const text = textOf(result);
	try {
		const parsed = JSON.parse(text);
		return typeof parsed === "object" && parsed !== null ? parsed : null;
	} catch {
		return null;
	}
}

function appleElementsOf(result) {
	const parsed = appleObservationOf(result);
	return Array.isArray(parsed?.elements) ? parsed.elements : [];
}

function findTextTarget(elements) {
	const isText = (element) => {
		const role = String(element?.role ?? "").toLowerCase();
		return role.includes("textarea") || role.includes("textview") || role.includes("textfield");
	};
	const direct = elements.find((element) => isText(element) && !element?.disabled);
	if (direct !== undefined) return direct;
	const walk = (nodes) => {
		for (const node of nodes ?? []) {
			if (isText(node)) return node;
			const child = walk(node.children);
			if (child !== undefined) return child;
		}
		return undefined;
	};
	return walk(elements);
}

function cuaElementsOf(result) {
	return result?.structuredContent?.elements ?? [];
}

function findCuaTextTarget(elements) {
	const isText = (element) => {
		const role = String(element?.role ?? "").toLowerCase();
		return role.includes("textarea") || role.includes("textview") || role.includes("textfield");
	};
	return elements.find((element) => isText(element) && element?.element_token !== undefined);
}

// ---- task scenarios ---------------------------------------------------------------------

const TASK_DIR = "/tmp/cua-task";
const TASK_FILE = path.join(TASK_DIR, "s1.txt");
const TASK_PAGE = path.join(TASK_DIR, "page.html");
const TASK_SENTENCE = "apple-cua task shootout 7f3a";
const TASK_HEADING = "CUA-TASK-HEADING-7f3a";

/**
 * The same task runs through each driver's own vocabulary; a PASS is decided by an oracle
 * outside the driver's own answer (the file on disk, the page source, the folder, the system
 * clipboard), and both drivers get the target app pre-activated by the harness as setup.
 */
function taskHaystack(result) {
	const structured = result?.structuredContent;
	return `${textOf(result)}\n${structured === undefined ? "" : JSON.stringify(structured)}`;
}

function pbpasteText() {
	try {
		return execFileSync("pbpaste", { encoding: "utf8", timeout: 10_000 });
	} catch {
		return "";
	}
}

function appleTaskRunner(client) {
	let calls = 0;
	let bytes = 0;
	let lastToken = "";
	const errors = [];
	const call = async (name, args) => {
		calls += 1;
		const result = await client.callTool(name, args);
		bytes += account(result).response_bytes;
		if (result?.isError === true) errors.push(textOf(result).slice(0, 140));
		return result;
	};
	const observe = async (app) => {
		const result = await call("get_app_state", { app, include_screenshot: false });
		const parsed = appleObservationOf(result);
		lastToken = typeof parsed?.observation_token === "string" ? parsed.observation_token : "";
		return result;
	};
	const mutate = async (app, invoke) => {
		if (lastToken === "") await observe(app);
		const result = await invoke(lastToken);
		const parsed = appleObservationOf(result);
		lastToken = typeof parsed?.observation_token === "string" ? parsed.observation_token : "";
		return result;
	};
	return {
		stats: () => ({ calls, payload_bytes: bytes, ...(errors.length === 0 ? {} : { errors: errors.slice(0, 2) }) }),
		reset: () => {
			calls = 0;
			bytes = 0;
			lastToken = "";
			errors.length = 0;
		},
		observe,
		type: async (app, text) =>
			await mutate(app, async (token) => await call("type_text", { app, observation_token: token, text })),
		keys: async (app, keys) =>
			await mutate(app, async (token) => await call("press_keys", { app, observation_token: token, keys })),
		clipboard: async () => await call("clipboard_read", {}),
		haystack: taskHaystack,
	};
}

function cuaTaskRunner(client) {
	let calls = 0;
	let bytes = 0;
	const errors = [];
	const targets = new Map();
	const call = async (name, args) => {
		calls += 1;
		const result = await client.callTool(name, args);
		bytes += account(result).response_bytes;
		if (result?.isError === true) errors.push(textOf(result).slice(0, 140));
		return result;
	};
	const titlePreference = { TextEdit: ["s1.txt"] };
	let lastRefresh = { windows: 0, error: null };
	const refreshTargets = async () => {
		const windows = await call("list_windows", {});
		const onScreen = (windows?.structuredContent?.windows ?? []).filter(
			(entry) => entry?.app_name !== undefined && entry.is_on_screen === true,
		);
		lastRefresh = {
			windows: onScreen.length,
			error: windows?.isError === true ? textOf(windows).slice(0, 200) : null,
		};
		for (const app of new Set(onScreen.map((entry) => entry.app_name))) {
			const candidates = onScreen.filter((entry) => entry.app_name === app);
			const preferred = (titlePreference[app] ?? []).flatMap((title) =>
				candidates.filter((entry) => String(entry.title) === title),
			);
			const chosen = preferred[0] ?? candidates[0];
			targets.set(app, { pid: chosen.pid, window_id: chosen.window_id, title: chosen.title });
		}
		return windows;
	};
	const ensureTarget = async (app) => {
		let target = targets.get(app);
		if (target === undefined) {
			await refreshTargets();
			target = targets.get(app);
		}
		if (target === undefined) throw new Error(`cua-driver has no on-screen window for ${app}`);
		return target;
	};
	const refusedKeys = (result) => result?.isError === true && textOf(result).includes("same_pid_keyboard_ambiguity");
	const staleWindow = (result) =>
		result?.isError === true &&
		/not a live window|window_id_not_found|window_owner_pid_mismatch/.test(textOf(result));
	const withTarget = async (app, invoke) => {
		const target = await ensureTarget(app);
		const result = await invoke(target);
		if (!staleWindow(result)) return result;
		await refreshTargets();
		return await invoke(await ensureTarget(app));
	};
	return {
		stats: () => ({ calls, payload_bytes: bytes, ...(errors.length === 0 ? {} : { errors: errors.slice(0, 2) }) }),
		reset: () => {
			calls = 0;
			bytes = 0;
			errors.length = 0;
		},
		refreshTargets,
		describeTargets: () => ({
			targets: Object.fromEntries([...targets].map(([app, target]) => [app, target.title])),
			last_refresh: lastRefresh,
		}),
		observe: async (app) =>
			await withTarget(
				app,
				async (target) =>
					await call("get_window_state", {
						pid: target.pid,
						window_id: target.window_id,
						include_screenshot: false,
					}),
			),
		type: async (app, text) =>
			await withTarget(app, async (target) => {
				const result = await call("type_text", { pid: target.pid, window_id: target.window_id, text });
				if (!refusedKeys(result)) return result;
				return await call("type_text", {
					pid: target.pid,
					window_id: target.window_id,
					text,
					delivery_mode: "foreground",
				});
			}),
		pressKey: async (app, key, modifiers) =>
			await withTarget(app, async (target) => {
				const args = {
					pid: target.pid,
					window_id: target.window_id,
					key,
					...(modifiers === undefined ? {} : { modifiers }),
				};
				const result = await call("press_key", args);
				if (!refusedKeys(result)) return result;
				return await call("press_key", { ...args, delivery_mode: "foreground" });
			}),
		clipboard: async () => await call("clipboard_read", { include_text: true }),
		haystack: taskHaystack,
	};
}

async function dismissSheet(app) {
	activateApp(app);
	await new Promise((resolve) => setTimeout(resolve, 250));
	try {
		execFileSync("osascript", ["-e", 'tell application "System Events" to key code 53'], {
			stdio: "pipe",
			timeout: 10_000,
		});
	} catch {
		// no sheet, or automation is unavailable
	}
	await new Promise((resolve) => setTimeout(resolve, 150));
}

function ensureTextEditDocument() {
	try {
		execFileSync("open", ["-e", TASK_FILE], { stdio: "pipe", timeout: 10_000 });
	} catch {
		// opening the document is a fixture precondition
	}
	try {
		execFileSync("osascript", ["-e", 'tell application "TextEdit" to set index of window "s1.txt" to 1'], {
			stdio: "pipe",
			timeout: 10_000,
		});
	} catch {
		// the document window may not be titled exactly s1.txt; the scenario reports what it finds
	}
	activateApp("TextEdit");
}

async function runTaskSuite(apple, cua, report) {
	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	mkdirSync(TASK_DIR, { recursive: true });
	writeFileSync(
		TASK_PAGE,
		`<!doctype html><html><head><title>cua task page</title></head><body><h1>${TASK_HEADING}</h1><p>apple-cua vs cua-driver task fixture.</p></body></html>\n`,
	);
	if (!existsSync(TASK_FILE)) writeFileSync(TASK_FILE, "");
	// one TextEdit document only: the fixture's scratch window would make per-pid keys ambiguous
	try {
		execFileSync(
			"osascript",
			["-e", 'tell application "TextEdit" to close (every window whose name is "scratch.txt") saving no'],
			{
				stdio: "pipe",
				timeout: 10_000,
			},
		);
	} catch {
		// the scratch window may already be closed
	}
	// a sheet left open by an earlier run makes its app's AX walk hang
	activateApp("Finder");
	await sleep(300);
	try {
		execFileSync("osascript", ["-e", 'tell application "System Events" to key code 53'], {
			stdio: "pipe",
			timeout: 10_000,
		});
	} catch {
		// no sheet, or automation is unavailable
	}
	ensureTextEditDocument();
	await sleep(1200);

	const savedClipboard = pbpasteText();
	const appleRunner = appleTaskRunner(apple);
	const cuaRunner = cuaTaskRunner(cua);

	const waitFor = async (check, deadlineMs) => {
		const deadline = performance.now() + deadlineMs;
		for (;;) {
			const outcome = await check();
			if (outcome.pass === true || performance.now() >= deadline) return outcome;
			await sleep(700);
		}
	};

	const specs = [
		{
			id: "textedit-fill-save",
			run: async (runner, kind) => {
				ensureTextEditDocument();
				await dismissSheet("TextEdit");
				await sleep(300);
				const start = performance.now();
				await runner.observe("TextEdit");
				if (kind === "apple") {
					await runner.keys("TextEdit", ["cmd+a"]);
				} else {
					await runner.pressKey("TextEdit", "a", ["cmd"]);
				}
				await runner.type("TextEdit", TASK_SENTENCE);
				if (kind === "apple") {
					await runner.keys("TextEdit", ["cmd+s"]);
				} else {
					await runner.pressKey("TextEdit", "s", ["cmd"]);
				}
				const seconds = (performance.now() - start) / 1000;
				const content = readFileSync(TASK_FILE, "utf8");
				return {
					seconds,
					pass: content.trim() === TASK_SENTENCE,
					oracle: `file=${JSON.stringify(content.slice(0, 80))}`,
				};
			},
		},
		{
			id: "clipboard-copy",
			run: async (runner, kind) => {
				ensureTextEditDocument();
				await dismissSheet("TextEdit");
				await sleep(300);
				const start = performance.now();
				await runner.observe("TextEdit");
				if (kind === "apple") {
					await runner.keys("TextEdit", ["cmd+a"]);
					await runner.keys("TextEdit", ["cmd+c"]);
				} else {
					await runner.pressKey("TextEdit", "a", ["cmd"]);
					await runner.pressKey("TextEdit", "c", ["cmd"]);
				}
				await sleep(150);
				const clip = await runner.clipboard();
				const seconds = (performance.now() - start) / 1000;
				const system = pbpasteText();
				return {
					seconds,
					pass: system.trim() === TASK_SENTENCE,
					oracle: `pbpaste=${JSON.stringify(system.trim().slice(0, 60))}`,
					note: runner.haystack(clip).includes(TASK_SENTENCE)
						? "driver read-back shows the text"
						: "driver read-back lacks the text",
				};
			},
		},
		{
			id: "browser-navigate-read",
			run: async (runner, kind) => {
				await dismissSheet("Safari");
				await sleep(600);
				const url = `file://${TASK_PAGE}`;
				const start = performance.now();
				await runner.observe("Safari");
				if (kind === "apple") {
					await runner.keys("Safari", ["cmd+l"]);
				} else {
					await runner.pressKey("Safari", "l", ["cmd"]);
				}
				await runner.type("Safari", url);
				if (kind === "apple") {
					await runner.keys("Safari", ["Return"]);
				} else {
					await runner.pressKey("Safari", "return");
				}
				const outcome = await waitFor(async () => {
					const observation = await runner.observe("Safari");
					return { pass: runner.haystack(observation).includes(TASK_HEADING) };
				}, 10_000);
				const seconds = (performance.now() - start) / 1000;
				return {
					seconds,
					pass: outcome.pass,
					oracle: `page source has heading: ${readFileSync(TASK_PAGE, "utf8").includes(TASK_HEADING)}`,
					note: outcome.pass ? undefined : "heading absent from the driver's read-back within 10 s",
				};
			},
		},
		{
			id: "finder-navigate",
			run: async (runner, kind) => {
				await dismissSheet("Finder");
				await sleep(300);
				const start = performance.now();
				await runner.observe("Finder");
				if (kind === "apple") {
					await runner.keys("Finder", ["shift+cmd+g"]);
				} else {
					await runner.pressKey("Finder", "g", ["shift", "cmd"]);
				}
				await runner.type("Finder", TASK_DIR);
				if (kind === "apple") {
					await runner.keys("Finder", ["Return"]);
				} else {
					await runner.pressKey("Finder", "return");
				}
				const outcome = await waitFor(async () => {
					const observation = await runner.observe("Finder");
					return { pass: runner.haystack(observation).includes("cua-task") };
				}, 8_000);
				const seconds = (performance.now() - start) / 1000;
				return { seconds, pass: outcome.pass, oracle: `folder exists: ${existsSync(TASK_DIR)}` };
			},
		},
	];

	// the browser task runs last: its AX hang must not contaminate the other scenarios
	const scenarioOrder = ["textedit-fill-save", "clipboard-copy", "finder-navigate", "browser-navigate-read"];

	const results = { apple_cua: {}, cua_driver: {} };
	for (const [driver, runner] of [
		["apple_cua", appleRunner],
		["cua_driver", cuaRunner],
	]) {
		if (driver === "cua_driver") {
			await runner.refreshTargets();
		}
		for (const id of scenarioOrder) {
			const spec = specs.find((entry) => entry.id === id);
			if (spec === undefined) continue;
			runner.reset();
			if (driver === "cua_driver") await runner.refreshTargets();
			let record;
			try {
				record = await spec.run(runner, driver === "apple_cua" ? "apple" : "cua");
			} catch (error) {
				record = { pass: false, error: String(error).slice(0, 400) };
			}
			results[driver][spec.id] = {
				pass: record.pass === true,
				seconds: round(record.seconds ?? 0),
				...runner.stats(),
				oracle: record.oracle,
				...(record.note === undefined ? {} : { note: record.note }),
				...(record.error === undefined ? {} : { error: record.error }),
			};
		}
		if (driver === "cua_driver") results.cua_targets = runner.describeTargets();
	}

	try {
		execFileSync("pbcopy", { input: savedClipboard, timeout: 10_000 });
	} catch {
		// restoring the clipboard is a courtesy, not a measurement
	}
	report.clipboard_restored = pbpasteText() === savedClipboard;
	return {
		setup: { dir: TASK_DIR, file: TASK_FILE, page: TASK_PAGE, sentence: TASK_SENTENCE, heading: TASK_HEADING },
		...results,
		clipboard_restored: report.clipboard_restored,
	};
}

async function main() {
	const report = {
		started_at: new Date().toISOString(),
		env: {
			platform: process.platform,
			arch: os.arch(),
			osRelease: os.release(),
			cpu: os.cpus()[0]?.model ?? "unknown",
			node: process.version,
		},
		iterations: ITERATIONS,
		actions: ACTIONS,
		warmups: WARMUPS,
		fixtures: {},
		tools: {},
		observation: {},
		action: {},
		cli_oneshot: {},
		notes: [],
		shapes: {},
	};

	// ---- fixture setup -----------------------------------------------------------------
	mkdirSync(SCRATCH_DIR, { recursive: true });
	if (!existsSync(SCRATCH_FILE)) writeFileSync(SCRATCH_FILE, "apple-cua shootout scratch\n");
	execFileSync("open", ["-e", SCRATCH_FILE]);
	execFileSync("open", [APPLE_CUA_ROOT]);
	await new Promise((resolve) => setTimeout(resolve, 2500));

	const apple = new McpClient({
		name: "apple-cua",
		command: "node",
		args: [APPLE_CUA_MCP],
		cwd: APPLE_CUA_ROOT,
		requestTimeoutMs: TASKS ? 60_000 : 180_000,
		envOverrides: {
			APPLE_CUA_ALLOWED_BUNDLE_IDS: TASKS
				? "com.apple.finder,com.apple.TextEdit,com.apple.Safari"
				: "com.apple.finder,com.apple.TextEdit",
			APPLE_CUA_DELIVERY: "background",
		},
	});
	const cua = new McpClient({
		name: "cua-driver",
		command: CUA_DRIVER,
		args: ["mcp"],
		cwd: APPLE_CUA_ROOT,
		requestTimeoutMs: TASKS ? 60_000 : 180_000,
	});
	await apple.start();
	await cua.start();

	try {
		report.handshakes = {
			appleCua: await apple.initialize(),
			cuaDriver: await cua.initialize(),
		};

		const appleTools = await timed(() => apple.request("tools/list", {}));
		const cuaTools = await timed(() => cua.request("tools/list", {}));
		report.tools = {
			apple_cua: {
				count: appleTools.result.tools.length,
				bytes: Buffer.byteLength(JSON.stringify(appleTools.result.tools), "utf8"),
				ms: round(appleTools.ms),
				names: appleTools.result.tools.map((tool) => tool.name),
			},
			cua_driver: {
				count: cuaTools.result.tools.length,
				bytes: Buffer.byteLength(JSON.stringify(cuaTools.result.tools), "utf8"),
				ms: round(cuaTools.ms),
				names: cuaTools.result.tools.map((tool) => tool.name),
			},
		};

		// ---- window discovery ---------------------------------------------------------
		const windowsResult = await cua.callTool("list_windows", {});
		const windows = windowsResult?.structuredContent?.windows ?? [];
		const finderWindows = windows.filter((w) => w.app_name === "Finder");
		const textEditWindows = windows.filter((w) => w.app_name === "TextEdit");
		const finderTarget =
			finderWindows.find((w) => String(w.title) === "apple-cua" && w.is_on_screen === true) ??
			finderWindows.find((w) => w.is_on_screen === true);
		const textEditTarget = textEditWindows.find((w) => w.is_on_screen === true) ?? textEditWindows[0];
		report.fixtures.windows = {
			finder_all: finderWindows.map((w) => ({
				window_id: w.window_id,
				pid: w.pid,
				title: w.title,
				bounds: w.bounds,
				on_screen: w.is_on_screen,
			})),
			textedit_all: textEditWindows.map((w) => ({
				window_id: w.window_id,
				pid: w.pid,
				title: w.title,
				bounds: w.bounds,
				on_screen: w.is_on_screen,
			})),
		};
		if (finderTarget === undefined || textEditTarget === undefined) {
			throw new Error("fixture windows not found (Finder/TextEdit)");
		}
		report.fixtures.targets = {
			finder: {
				pid: finderTarget.pid,
				window_id: finderTarget.window_id,
				title: finderTarget.title,
				bounds: finderTarget.bounds,
			},
			textedit: {
				pid: textEditTarget.pid,
				window_id: textEditTarget.window_id,
				title: textEditTarget.title,
				bounds: textEditTarget.bounds,
			},
		};

		if (TASKS) {
			report.tasks = await runTaskSuite(apple, cua, report);
			report.finished_at = new Date().toISOString();
			mkdirSync(path.dirname(OUT), { recursive: true });
			writeFileSync(OUT, JSON.stringify(report, null, 2));
			console.log(JSON.stringify(report, null, 2));
			return;
		}

		if (PROBE) {
			const appleFinder = await apple.callTool("get_app_state", { app: "Finder" });
			const cuaFinder = await cua.callTool("get_window_state", {
				pid: finderTarget.pid,
				window_id: finderTarget.window_id,
			});
			report.shapes.apple_finder = {
				content_types: (appleFinder.content ?? []).map((b) => b.type),
				structured_keys:
					appleFinder.structuredContent === undefined ? null : Object.keys(appleFinder.structuredContent),
				text_head: textOf(appleFinder).slice(0, 600),
			};
			report.shapes.cua_finder = {
				content_types: (cuaFinder.content ?? []).map((b) => b.type),
				structured_keys:
					cuaFinder.structuredContent === undefined ? null : Object.keys(cuaFinder.structuredContent),
				text_head: textOf(cuaFinder).slice(0, 600),
				meta:
					cuaFinder.structuredContent === undefined
						? null
						: {
								element_count: cuaFinder.structuredContent.element_count,
								screenshot_width: cuaFinder.structuredContent.screenshot_width,
								screenshot_height: cuaFinder.structuredContent.screenshot_height,
								screenshot_scale: cuaFinder.structuredContent.screenshot_scale,
								window_title: cuaFinder.structuredContent.window_title,
								window_bounds: cuaFinder.structuredContent.window_bounds,
							},
			};
			const appleText = await apple.callTool("get_app_state", { app: "TextEdit" });
			const textTarget = findTextTarget(appleElementsOf(appleText));
			report.shapes.apple_text_target =
				textTarget === undefined
					? null
					: {
							keys: Object.keys(textTarget),
							role: textTarget.role,
							id: textTarget.id ?? textTarget.index ?? null,
						};
			const cuaText = await cua.callTool("get_window_state", {
				pid: textEditTarget.pid,
				window_id: textEditTarget.window_id,
			});
			const cuaTarget = findCuaTextTarget(cuaElementsOf(cuaText));
			report.shapes.cua_text_target =
				cuaTarget === undefined
					? null
					: {
							role: cuaTarget.role,
							element_index: cuaTarget.element_index,
							has_token: cuaTarget.element_token !== undefined,
							keys: Object.keys(cuaTarget),
						};
			console.log(JSON.stringify(report, null, 2).slice(0, 12000));
			writeFileSync("/tmp/shootout-probe.json", JSON.stringify(report, null, 2));
			return;
		}

		if (FOREGROUND_PROBE) {
			report.fixtures.foreground_probe = await runForegroundProbe(apple, cua, {
				appleApp: "TextEdit",
				cuaPid: textEditTarget.pid,
				cuaWindowId: textEditTarget.window_id,
			});
			console.log(JSON.stringify(report, null, 2).slice(0, 12000));
			writeFileSync("/tmp/shootout-foreground-probe.json", JSON.stringify(report, null, 2));
			return;
		}

		// ---- observation measurements --------------------------------------------------
		report.observation.finder = await measureObservations(
			apple,
			cua,
			{
				label: "Finder",
				appleApp: "Finder",
				cuaPid: finderTarget.pid,
				cuaWindowId: finderTarget.window_id,
			},
			report,
		);
		report.observation.textedit = await measureObservations(
			apple,
			cua,
			{
				label: "TextEdit",
				appleApp: "TextEdit",
				cuaPid: textEditTarget.pid,
				cuaWindowId: textEditTarget.window_id,
			},
			report,
		);

		// ---- action measurements (TextEdit only; nothing is modified but the scratch file) ----
		report.action = await measureActions(
			apple,
			cua,
			{
				appleApp: "TextEdit",
				cuaPid: textEditTarget.pid,
				cuaWindowId: textEditTarget.window_id,
			},
			report,
		);

		// ---- one-shot CLI reference (cua only): spawn + IPC per call --------------------
		const cliSamples = [];
		for (let index = 0; index < 3; index += 1) {
			const start = performance.now();
			try {
				execFileSync(
					CUA_DRIVER,
					[
						"call",
						"get_window_state",
						"--json",
						JSON.stringify({
							pid: finderTarget.pid,
							window_id: finderTarget.window_id,
							include_screenshot: false,
						}),
					],
					{ stdio: "pipe", timeout: 60_000 },
				);
				cliSamples.push(performance.now() - start);
			} catch (error) {
				report.notes.push(`cua-driver one-shot CLI failed: ${String(error).slice(0, 200)}`);
			}
		}
		if (cliSamples.length > 0) report.cli_oneshot.get_window_state_ax_only = summarize(cliSamples);
	} catch (error) {
		report.error = String(error?.stack ?? error);
	} finally {
		apple.stop();
		cua.stop();
	}

	report.finished_at = new Date().toISOString();
	mkdirSync(path.dirname(OUT), { recursive: true });
	writeFileSync(OUT, JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report, null, 2));
}

async function measureObservations(apple, cua, fixture, report) {
	const appleFull = [];
	const appleAx = [];
	const appleCapture = [];
	const cuaFull = [];
	const cuaAx = [];
	const cuaCapture = [];
	const appleSamples = [];
	const cuaSamples = [];
	const cuaCaptureSamples = [];
	const appleCaptureSamples = [];
	const meta = {};

	for (let index = 0; index < WARMUPS + ITERATIONS; index += 1) {
		const counted = index >= WARMUPS;

		const appleObs = await timed(() => apple.callTool("get_app_state", { app: fixture.appleApp }));
		const appleParsed = appleObservationOf(appleObs.result);
		if (appleParsed !== null) {
			meta.appleWindow = {
				app: appleParsed.app,
				pid: appleParsed.pid,
				windowTitle: appleParsed.windowTitle,
				windowId: appleParsed.windowId,
				windowBounds: appleParsed.windowBounds,
				element_count: Array.isArray(appleParsed.elements) ? appleParsed.elements.length : null,
				screenshotWidth: appleParsed.screenshotWidth,
				screenshotHeight: appleParsed.screenshotHeight,
				screenshotMimeType: appleParsed.screenshotMimeType,
				contentKind: appleParsed.contentKind,
			};
		}
		if (counted) {
			appleFull.push(appleObs.ms);
			appleSamples.push({ ...account(appleObs.result), ms: round(appleObs.ms) });
		}

		const appleAxOnly = await timed(() =>
			apple.callTool("get_app_state", { app: fixture.appleApp, include_screenshot: false }),
		);
		if (counted) appleAx.push(appleAxOnly.ms);

		const appleCaptureOnly = await timed(() =>
			apple.callTool("get_app_state", {
				app: fixture.appleApp,
				include_accessibility_tree: false,
				settle_ms: 0,
			}),
		);
		if (counted) {
			appleCapture.push(appleCaptureOnly.ms);
			appleCaptureSamples.push({ ...account(appleCaptureOnly.result), ms: round(appleCaptureOnly.ms) });
		}

		const cuaObs = await timed(() =>
			cua.callTool("get_window_state", { pid: fixture.cuaPid, window_id: fixture.cuaWindowId }),
		);
		if (counted) {
			cuaFull.push(cuaObs.ms);
			cuaSamples.push({ ...account(cuaObs.result), ms: round(cuaObs.ms) });
		}
		const structured = cuaObs.result?.structuredContent;
		if (structured !== undefined) {
			meta.cuaWindow = {
				app_name: structured.app_name,
				window_title: structured.window_title,
				element_count: structured.element_count,
				screenshot_width: structured.screenshot_width,
				screenshot_height: structured.screenshot_height,
				screenshot_scale: structured.screenshot_scale,
				window_bounds: structured.window_bounds,
			};
		}

		const cuaAxOnly = await timed(() =>
			cua.callTool("get_window_state", {
				pid: fixture.cuaPid,
				window_id: fixture.cuaWindowId,
				include_screenshot: false,
			}),
		);
		if (counted) cuaAx.push(cuaAxOnly.ms);

		const cuaCaptureOnly = await timed(() =>
			cua.callTool("get_window_state", {
				pid: fixture.cuaPid,
				window_id: fixture.cuaWindowId,
				include_accessibility_tree: false,
			}),
		);
		if (counted) {
			cuaCapture.push(cuaCaptureOnly.ms);
			cuaCaptureSamples.push({ ...account(cuaCaptureOnly.result), ms: round(cuaCaptureOnly.ms) });
		}
	}

	const last = (samples) => samples[samples.length - 1] ?? {};
	const withImage = (samples) => samples.find((sample) => sample.image_bytes > 0) ?? {};
	return {
		label: fixture.label,
		meta,
		apple_cua: {
			full_observation_ms: summarize(appleFull),
			ax_only_ms: summarize(appleAx),
			capture_only_ms: summarize(appleCapture),
			derived_screenshot_ms: round(summarize(appleFull).p50 - summarize(appleAx).p50),
			payload_full: last(appleSamples),
			payload_capture_only: last(appleCaptureSamples),
			payload_full_bytes: withImage(appleSamples).response_bytes ?? 0,
			samples_ms: appleSamples.map((sample) => sample.ms),
		},
		cua_driver: {
			full_observation_ms: summarize(cuaFull),
			ax_only_ms: summarize(cuaAx),
			capture_only_ms: summarize(cuaCapture),
			derived_ax_ms: round(summarize(cuaFull).p50 - summarize(cuaCapture).p50),
			payload_full: last(cuaSamples),
			payload_full_bytes: withImage(cuaSamples).response_bytes ?? 0,
			payload_capture_only: last(cuaCaptureSamples),
			samples_ms: cuaSamples.map((sample) => sample.ms),
		},
	};
}

async function measureActions(apple, cua, fixture, report) {
	const result = {
		fixture: "TextEdit",
		typed_text: TYPED_TEXT,
		rung_probe: {},
		apple_cua: {},
		cua_driver: {},
	};

	// ---- one-off AX-rung probe: press the text area by element id (evidence, not latency) ----
	try {
		const appleObs = await apple.callTool("get_app_state", { app: fixture.appleApp, include_screenshot: false });
		const appleParsed = appleObservationOf(appleObs);
		const appleElement = findTextTarget(appleElementsOf(appleObs));
		const applePress = await apple.callTool("click", {
			app: fixture.appleApp,
			observation_token: appleParsed?.observation_token,
			element_index: String(appleElement?.id ?? ""),
		});
		result.rung_probe.apple_cua_element_press = {
			failed: failed(applePress),
			text: textOf(applePress).slice(0, 240),
		};
	} catch (error) {
		result.rung_probe.apple_cua_element_press = { failed: true, text: String(error).slice(0, 240) };
	}
	try {
		const cuaObs = await cua.callTool("get_window_state", {
			pid: fixture.cuaPid,
			window_id: fixture.cuaWindowId,
			include_screenshot: false,
		});
		const element = findCuaTextTarget(cuaElementsOf(cuaObs));
		const cuaPress = await cua.callTool("click", {
			pid: fixture.cuaPid,
			window_id: fixture.cuaWindowId,
			element_token: element?.element_token,
		});
		result.rung_probe.cua_driver_element_press = {
			failed: failed(cuaPress),
			text: textOf(cuaPress).slice(0, 240),
		};
	} catch (error) {
		result.rung_probe.cua_driver_element_press = { failed: true, text: String(error).slice(0, 240) };
	}

	// ---- timed loops: pixel-rung click, type, key; a fresh observation precedes every action ----
	const samples = { appleClick: [], appleType: [], appleKey: [], cuaClick: [], cuaType: [], cuaKey: [] };
	const failures = [];
	let appleClickPayload = {};
	let cuaClickPayload = {};

	const record = (bucket, ms, outcome, label) => {
		const ok = !failed(outcome);
		samples[bucket].push({ ms: round(ms), ok });
		if (!ok) failures.push({ label, text: textOf(outcome).slice(0, 200) });
	};

	for (let index = 0; index < WARMUPS + ACTIONS; index += 1) {
		const counted = index >= WARMUPS;
		if (counted) activateApp(fixture.appleApp);

		// ---- apple-cua ----
		const appleObs = await apple.callTool("get_app_state", { app: fixture.appleApp, include_screenshot: false });
		const appleParsed = appleObservationOf(appleObs);
		const appleToken = appleParsed?.observation_token;
		const appleElement = findTextTarget(appleElementsOf(appleObs));
		if (typeof appleToken !== "string" || appleElement?.frame === undefined) {
			report.notes.push("apple-cua observation lacked observation_token or a text-area frame");
			break;
		}
		const appleCenter = frameCenter(appleElement.frame);

		const appleClick = await timed(() =>
			apple.callTool("click", {
				app: fixture.appleApp,
				observation_token: appleToken,
				x: appleCenter.x,
				y: appleCenter.y,
			}),
		);

		if (counted) {
			record("appleClick", appleClick.ms, appleClick.result, "apple-cua pixel click");
			if (!failed(appleClick.result)) appleClickPayload = account(appleClick.result);
		}

		if (counted) activateApp(fixture.appleApp);
		const appleObs2 = await apple.callTool("get_app_state", { app: fixture.appleApp, include_screenshot: false });
		const appleToken2 = appleObservationOf(appleObs2)?.observation_token;
		const appleType = await timed(() =>
			apple.callTool("type_text", { app: fixture.appleApp, observation_token: appleToken2, text: TYPED_TEXT }),
		);
		if (counted) record("appleType", appleType.ms, appleType.result, "apple-cua type_text");

		if (counted) activateApp(fixture.appleApp);
		const appleObs3 = await apple.callTool("get_app_state", { app: fixture.appleApp, include_screenshot: false });
		const appleToken3 = appleObservationOf(appleObs3)?.observation_token;
		const appleKey = await timed(() =>
			apple.callTool("press_keys", { app: fixture.appleApp, observation_token: appleToken3, keys: ["left"] }),
		);
		if (counted) record("appleKey", appleKey.ms, appleKey.result, "apple-cua press_keys");

		// ---- cua-driver ----
		const cuaObs = await cua.callTool("get_window_state", {
			pid: fixture.cuaPid,
			window_id: fixture.cuaWindowId,
			include_screenshot: false,
		});
		const cuaElement = findCuaTextTarget(cuaElementsOf(cuaObs));
		if (cuaElement?.frame === undefined) {
			report.notes.push("cua-driver snapshot lacked a text-area frame");
			break;
		}
		const cuaStructured = cuaObs?.structuredContent ?? {};
		const cuaCenter = cuaClickCenter(cuaElement.frame, cuaStructured);

		const cuaClick = await timed(() =>
			cua.callTool("click", {
				pid: fixture.cuaPid,
				window_id: fixture.cuaWindowId,
				x: cuaCenter.x,
				y: cuaCenter.y,
			}),
		);
		if (counted) {
			record("cuaClick", cuaClick.ms, cuaClick.result, "cua-driver pixel click");
			if (!failed(cuaClick.result)) cuaClickPayload = account(cuaClick.result);
		}

		const cuaType = await timed(() =>
			cua.callTool("type_text", { pid: fixture.cuaPid, window_id: fixture.cuaWindowId, text: TYPED_TEXT }),
		);
		if (counted) record("cuaType", cuaType.ms, cuaType.result, "cua-driver type_text");

		const cuaKey = await timed(() =>
			cua.callTool("press_key", { pid: fixture.cuaPid, window_id: fixture.cuaWindowId, key: "left" }),
		);
		if (counted) record("cuaKey", cuaKey.ms, cuaKey.result, "cua-driver press_key");
	}

	const summarizeOk = (bucket) => {
		const okMs = samples[bucket].filter((sample) => sample.ok).map((sample) => sample.ms);
		return { ...summarize(okMs), attempted: samples[bucket].length, ok: okMs.length };
	};

	result.apple_cua = {
		click_pixel_ms: summarizeOk("appleClick"),
		type_text_ms: summarizeOk("appleType"),
		press_keys_ms: summarizeOk("appleKey"),
		click_payload: appleClickPayload,
		text_target: await appleTextTargetShape(apple, fixture),
	};
	result.cua_driver = {
		click_pixel_ms: summarizeOk("cuaClick"),
		type_text_ms: summarizeOk("cuaType"),
		press_key_ms: summarizeOk("cuaKey"),
		click_payload: cuaClickPayload,
	};
	result.failures = failures;
	return result;
}

async function appleTextTargetShape(apple, fixture) {
	try {
		const obs = await apple.callTool("get_app_state", { app: fixture.appleApp, include_screenshot: false });
		const element = findTextTarget(appleElementsOf(obs));
		return element === undefined
			? null
			: { id: element.id, role: element.role, frame: element.frame, actions: element.actions };
	} catch {
		return null;
	}
}

await main();

#!/usr/bin/env node
/**
 * Live proof for strategic targeting: the described-element tools (open_app, find_elements,
 * click_target) driven over MCP stdio against a real app, plus the head-to-head that shows the
 * strategic path beating the robot loop (get_app_state -> click -> verify_state) in wall time
 * and answer bytes.
 *
 * The server is spawned through the signed TCC helper bundle when it is present, so the run has
 * the same Screen Recording / Accessibility identity the registered server uses.
 *
 * Usage:
 *   node scripts/measure-strategic-targeting.mjs --probe
 *   node scripts/measure-strategic-targeting.mjs --iterations 5 \
 *     --out .sisyphus/evidence/strategic-targeting-live.json
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = process.env.STRATEGIC_SERVER ?? path.join(REPO, "packages/mcp/dist/server.js");
const HELPER = "/Users/bob/src/apple-cua/packages/mcp/dist/apple-cua-mcp.app/Contents/MacOS/apple-cua-mcp";
const APP = process.env.STRATEGIC_APP ?? "Finder";
const TOOL_NAMES = ["open_app", "find_elements", "click_target"];

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
	const index = argv.indexOf(`--${name}`);
	return index === -1 ? fallback : argv[index + 1];
};
const PROBE = argv.includes("--probe");
const DIRECT = argv.includes("--direct");
const FIND = flag("find", undefined);
const AXPRESS_ONLY = argv.includes("--axpress-only");
const ITERATIONS = Number(flag("iterations", 5));
const OUT = flag("out", ".sisyphus/evidence/strategic-targeting-live.json");
const BENCH_OUT = flag("bench-out", ".sisyphus/evidence/strategic-targeting-bench.json");

/** Minimal MCP stdio client: newline-delimited JSON-RPC 2.0. */
class McpClient {
	constructor({ command, args, envOverrides = {} }) {
		this.command = command;
		this.args = args;
		this.envOverrides = envOverrides;
		this.nextId = 1;
		this.pending = new Map();
		this.stderrTail = [];
	}

	start() {
		this.child = spawn(this.command, this.args, {
			cwd: REPO,
			env: { ...process.env, ...this.envOverrides },
			stdio: ["pipe", "pipe", "pipe"],
		});
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
			if (message.error) reject(new Error(`server error: ${JSON.stringify(message.error)}`));
			else resolve(message.result);
		}
	}

	request(method, params, timeoutMs = 180_000) {
		const id = this.nextId++;
		const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`timeout after ${timeoutMs}ms on ${method}`));
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
			clientInfo: { name: "strategic-targeting-live", version: "0.1.0" },
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

/** The JSON payload of a tool answer, and its size in bytes as the model would receive it. */
function payload(result) {
	const content = Array.isArray(result?.content) ? result.content : [];
	const text = [...content].reverse().find((item) => item?.type === "text");
	if (text === undefined) return { json: undefined, bytes: 0 };
	const bytes = Buffer.byteLength(text.text, "utf8");
	try {
		return { json: JSON.parse(text.text), bytes };
	} catch {
		// Never lose evidence: a refusal or thrown error arrives as plain text, not JSON.
		return { json: undefined, raw: text.text.slice(0, 2_000), bytes };
	}
}

function contentBytes(result) {
	const content = Array.isArray(result?.content) ? result.content : [];
	return content.reduce((total, item) => {
		if (item?.type === "text") return total + Buffer.byteLength(item.text, "utf8");
		if (item?.type === "image") return total + Buffer.byteLength(item.data ?? "", "utf8");
		return total;
	}, 0);
}

async function timed(run) {
	const startedAt = performance.now();
	const value = await run();
	return { value, milliseconds: Math.round(performance.now() - startedAt) };
}

function createClient() {
	const useHelper = !DIRECT && existsSync(HELPER);
	const client = new McpClient({
		command: useHelper ? HELPER : process.execPath,
		args: [SERVER],
		envOverrides: {
			APPLE_CUA_ALLOWED_BUNDLE_IDS: "com.apple.finder,com.apple.TextEdit",
			APPLE_CUA_DELIVERY: "background",
		},
	});
	return { client, via: useHelper ? `signed helper ${HELPER}` : `node ${SERVER}` };
}

/**
 * A live proof of the accessibility route, self-contained in a throwaway Finder window: open one
 * (cmd+N), give it history (cmd+up), then click "back" and "forward" by description. Both
 * advertise AXPress, so a route of "accessibility" is the dispatch path being exercised, and the
 * window title changing back and forth is the visible effect. The window is closed at the end.
 */
async function liveAxPressScenario(client, evidence) {
	if (APP !== "Finder") {
		return;
	}
	const startedAt = performance.now();
	let bytes = 0;
	const step = { step: "live_axpress", milliseconds: 0, bytes: 0 };

	const before = await finderWindowIds(client);
	const opened = await pressKeys(client, "Finder", ["cmd+n"]);
	bytes += opened.bytes;
	const windowId = await waitForEndpoint(async () => {
		const ids = await finderWindowIds(client);
		return ids.find((id) => !before.includes(id));
	}, "a new Finder window");
	if (windowId === undefined) {
		step.status = "failed";
		step.reason = "cmd+N did not produce a new Finder window";
		step.milliseconds = Math.round(performance.now() - startedAt);
		evidence.steps.push(step);
		console.log("live AXPress: FAILED to open a throwaway window");
		return;
	}
	step.windowId = windowId;

	const seeded = await pressKeys(client, "Finder", ["cmd+up"], windowId);
	bytes += seeded.bytes;
	const titleStart = await windowTitle(client, windowId);
	try {
		const back = await clickByLabel(client, "back", windowId);
		bytes += back.bytes;
		step.back = back.step;
		const forward = await clickByLabel(client, "forward", windowId);
		bytes += forward.bytes;
		step.forward = forward.step;
		step.titles = { start: titleStart, afterBack: back.step.titleAfter, afterForward: forward.step.titleAfter };
		step.status =
			back.step.found === true &&
			back.step.route === "accessibility" &&
			back.step.titleAfter !== titleStart &&
			forward.step.route === "accessibility" &&
			forward.step.titleAfter !== back.step.titleAfter
				? "verified"
				: "unverified";
		console.log(
			`live AXPress: back -> ${JSON.stringify(back.step.titleAfter)} (${back.step.route}), forward -> ${JSON.stringify(forward.step.titleAfter)} (${forward.step.route}) [${step.status}]`,
		);
	} finally {
		const closed = await pressKeys(client, "Finder", ["cmd+w"], windowId);
		bytes += closed.bytes;
		const stillOpen = await waitForEndpoint(async () => {
			const ids = await finderWindowIds(client);
			return ids.includes(windowId) ? undefined : "closed";
		}, "the throwaway window to close");
		step.cleanup = { closed: stillOpen === "closed", windowId };
	}
	step.milliseconds = Math.round(performance.now() - startedAt);
	step.bytes = bytes;
	evidence.steps.push(step);
}

async function finderWindowIds(client) {
	const result = await client.callTool("list_windows", {});
	const windows = payload(result).json?.windows ?? [];
	return windows.filter((window) => window.app === "Finder").map((window) => window.window_id);
}

/** Send a key chord to an app, refreshing the observation token the press requires. */
async function pressKeys(client, app, keys, windowId) {
	const state = await client.callTool(
		"get_app_state",
		windowId === undefined ? { app } : { app, window_id: windowId },
	);
	const token = payload(state).json?.observation_token;
	const pressed = await client.callTool("press_keys", { app, observation_token: token, keys });
	return { pressed: payload(pressed).json, bytes: contentBytes(state) + contentBytes(pressed) };
}

async function windowTitle(client, windowId) {
	const state = await client.callTool("get_app_state", { app: "Finder", window_id: windowId });
	return payload(state).json?.windowTitle ?? null;
}

async function clickByLabel(client, label, windowId) {
	const result = await client.callTool("click_target", {
		app: "Finder",
		window_id: windowId,
		query: { role: "button", label },
	});
	const clicked = payload(result).json;
	return {
		bytes: contentBytes(result),
		step: {
			label,
			found: clicked?.found,
			route: clicked?.route,
			dispatched: clicked?.actionDispatched,
			target: clicked?.target ?? null,
			titleAfter: clicked?.windowTitle ?? null,
			isError: result.isError === true,
		},
	};
}

/** Poll a real UI change with a deadline; the script's own waiting, never the product's. */
async function waitForEndpoint(read, description) {
	const deadline = Date.now() + 5_000;
	for (;;) {
		const value = await read();
		if (value !== undefined && value !== null) {
			return value;
		}
		if (Date.now() >= deadline) {
			console.log(`live AXPress: timed out waiting for ${description}`);
			return undefined;
		}
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
}

async function main() {
	prepareFixture();
	const { client, via } = createClient();
	await client.start();
	const evidence = {
		startedAt: new Date().toISOString(),
		server: SERVER,
		spawnedVia: via,
		app: APP,
		probe: PROBE,
		steps: [],
	};
	try {
		const init = await client.initialize();
		const tools = await client.request("tools/list", {});
		const names = (tools?.tools ?? []).map((tool) => tool.name);
		evidence.serverInfo = init?.serverInfo;
		evidence.toolCount = names.length;
		evidence.strategicToolsPresent = TOOL_NAMES.filter((name) => names.includes(name));
		console.log(`server ${init?.serverInfo?.name} v${init?.serverInfo?.version} — ${names.length} tools via ${via}`);
		console.log(`strategic tools present: ${evidence.strategicToolsPresent.join(", ")}`);

		if (FIND !== undefined) {
			const query = JSON.parse(FIND);
			const found = await timed(() => client.callTool("find_elements", { app: APP, query, max_results: 12 }));
			const foundPayload = payload(found.value);
			console.log(
				`find_elements ${JSON.stringify(query)} -> found=${foundPayload.json?.found} ${found.milliseconds}ms`,
			);
			if (foundPayload.raw !== undefined) console.log(`  RAW: ${foundPayload.raw}`);
			for (const match of foundPayload.json?.matches ?? []) {
				console.log(
					`  ${match.element_index} ${match.role} label=${JSON.stringify(match.label)} value=${JSON.stringify(match.value)} actions=${JSON.stringify(match.actions)} frame=${JSON.stringify(match.frame)}`,
				);
			}
			evidence.steps.push({
				step: "find",
				query,
				milliseconds: found.milliseconds,
				payload: foundPayload.json,
				raw: foundPayload.raw,
			});
			writeEvidence(evidence);
			return;
		}

		if (PROBE) {
			const state = await timed(() => client.callTool("get_app_state", { app: APP }));
			const statePayload = payload(state.value);
			console.log(`get_app_state -> ${statePayload.json === undefined ? "ERROR" : "ok"} ${state.milliseconds}ms`);
			if (statePayload.raw !== undefined) console.log(`  RAW: ${statePayload.raw}`);
			evidence.steps.push({
				step: "probe_get_app_state",
				milliseconds: state.milliseconds,
				raw: statePayload.raw,
				ok: statePayload.json !== undefined,
			});

			const open = await timed(() => client.callTool("open_app", { name: APP }));
			console.log(`open_app ${APP} -> ${open.value?.isError ? "ERROR" : "ok"} ${open.milliseconds}ms`);
			const openPayload = payload(open.value).json;
			evidence.steps.push({ step: "probe_open_app", milliseconds: open.milliseconds, payload: openPayload });

			for (const query of [{ role: "textarea" }, { role: "textfield" }, { role: "button" }, { text: "scratch" }]) {
				const found = await timed(() => client.callTool("find_elements", { app: APP, query, max_results: 8 }));
				const foundPayload = payload(found.value);
				console.log(
					`\nfind_elements ${JSON.stringify(query)} -> found=${foundPayload.json?.found} ${found.milliseconds}ms`,
				);
				if (foundPayload.raw !== undefined) {
					console.log(`  RAW: ${foundPayload.raw}`);
				}
				for (const match of foundPayload.json?.matches ?? []) {
					console.log(
						`  ${match.element_index} ${match.role} label=${JSON.stringify(match.label)} value=${JSON.stringify(match.value)} actions=${JSON.stringify(match.actions)} @${JSON.stringify(match.frame)}`,
					);
				}
				evidence.steps.push({
					step: "probe_find",
					query,
					milliseconds: found.milliseconds,
					payload: foundPayload.json,
					raw: foundPayload.raw,
				});
			}
			writeEvidence(evidence);
			return;
		}

		if (AXPRESS_ONLY) {
			const open = await timed(() => client.callTool("open_app", { name: APP }));
			evidence.steps.push({ step: "open_app", milliseconds: open.milliseconds, payload: payload(open.value).json });
			await liveAxPressScenario(client, evidence);
			writeEvidence(evidence);
			return;
		}

		// ---- Live strategic flow: open -> find -> click -> verify (criterion 7) ----
		const open = await timed(() => client.callTool("open_app", { name: APP }));
		evidence.steps.push({
			step: "open_app",
			milliseconds: open.milliseconds,
			payload: payload(open.value).json,
			bytes: contentBytes(open.value),
			isError: open.value?.isError === true,
		});

		const target = await chooseTarget(client, evidence);
		evidence.target = {
			query: target.query,
			index: target.index,
			elementIndex: target.elementIndex,
			label: target.label,
		};

		const clicked = await timed(() =>
			client.callTool("click_target", {
				app: APP,
				query: target.query,
				index: target.index,
				timeout_ms: 3_000,
				hover_first: true,
				expect: { checks: [{ element_index: String(target.elementIndex), exists: true }] },
			}),
		);
		const clickedPayload = payload(clicked.value).json;
		evidence.steps.push({
			step: "click_target",
			milliseconds: clicked.milliseconds,
			bytes: contentBytes(clicked.value),
			isError: clicked.value?.isError === true,
			payload: clickedPayload,
		});
		console.log(
			`click_target -> found=${clickedPayload?.found} route=${clickedPayload?.route} verified=${clickedPayload?.verification?.verified} ${clicked.milliseconds}ms`,
		);

		const missed = await timed(() =>
			client.callTool("click_target", {
				app: APP,
				query: { label: "Definitely Not A Control 99" },
				timeout_ms: 300,
			}),
		);
		const missedPayload = payload(missed.value).json;
		evidence.steps.push({
			step: "click_target_miss",
			milliseconds: missed.milliseconds,
			bytes: contentBytes(missed.value),
			isError: missed.value?.isError === true,
			payload: missedPayload,
		});
		console.log(
			`click_target miss -> found=${missedPayload?.found} nearMisses=${missedPayload?.nearMisses?.length} dispatched=${missedPayload?.actionDispatched} ${missed.milliseconds}ms`,
		);

		// A miss that still teaches: the words match nothing, so the role's own controls are listed.
		const guided = await timed(() =>
			client.callTool("click_target", {
				app: APP,
				query: { role: "button", label: "foward" },
				timeout_ms: 0,
			}),
		);
		const guidedPayload = payload(guided.value).json;
		evidence.steps.push({
			step: "click_target_miss_with_role_hint",
			milliseconds: guided.milliseconds,
			bytes: contentBytes(guided.value),
			isError: guided.value?.isError === true,
			payload: guidedPayload,
		});
		console.log(
			`click_target role-hint miss -> found=${guidedPayload?.found} nearMisses=${guidedPayload?.nearMisses?.length} dispatched=${guidedPayload?.actionDispatched} ${guided.milliseconds}ms`,
		);

		// ---- Live accessibility-route proof: a real AXPress click that visibly navigates and restores ----
		await liveAxPressScenario(client, evidence);

		// ---- Speed and stability: strategic path vs robot loop (criterion 8) ----
		const runs = [];
		for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
			runs.push(await robotLoop(client, target, iteration));
			runs.push(await strategicPath(client, target, iteration));
		}
		evidence.bench = {
			iterations: ITERATIONS,
			runs,
			summary: summarize(runs),
		};
		console.log("\nrun  approach   ms   bytes  route         target  verified  dispatched");
		for (const run of runs) {
			console.log(
				`${String(run.iteration).padStart(3)}  ${run.approach.padEnd(10)} ${String(run.milliseconds).padStart(4)}  ${String(run.bytes).padStart(6)}  ${String(run.clickRoute).padEnd(12)}  ${run.elementIndex ?? "-"}  ${run.verified}       ${run.dispatched}`,
			);
		}
		const summary = evidence.bench.summary;
		console.log(
			`\nrobot loop: ${summary.robot.medianMs}ms median, ${summary.robot.medianBytes}B median, ${summary.robot.verified}/${summary.robot.runs} verified`,
		);
		console.log(
			`strategic:  ${summary.strategic.medianMs}ms median, ${summary.strategic.medianBytes}B median, ${summary.strategic.verified}/${summary.strategic.runs} verified`,
		);
		writeEvidence(evidence);
	} finally {
		client.stop();
	}
}

/** Prepare a scratch document so a text app has a real window to describe elements in. */
function prepareFixture() {
	const dir = "/tmp/apple-cua-strategic";
	mkdirSync(dir, { recursive: true });
	const file = path.join(dir, "scratch.txt");
	writeFileSync(file, "apple-cua strategic targeting scratch document\n");
	if (APP === "TextEdit") {
		execFileSync("open", ["-a", "TextEdit", file]);
	}
}

/** Pick a real, safe target: prefer a text field (focusing one is idempotent), else a tab. */
async function chooseTarget(client, evidence) {
	for (const query of [{ role: "textarea" }, { role: "textfield" }, { role: "button" }]) {
		const result = await client.callTool("find_elements", { app: APP, query, max_results: 5 });
		const found = payload(result).json;
		const match = found?.matches?.[0];
		evidence.steps.push({
			step: "choose_target",
			query,
			found: found?.found === true,
			firstMatch: match ?? null,
		});
		if (match !== undefined) {
			console.log(
				`target: ${match.element_index} ${match.role} ${JSON.stringify(match.label)} (${JSON.stringify(query)})`,
			);
			return { query, index: 0, elementIndex: match.element_index, label: match.label ?? "" };
		}
	}
	throw new Error("no target element found in the live tree");
}

/** The robot loop an agent runs today: observe the whole tree (pixels included by default),
 *  click by id when the control is pressable or by measured viewport coordinates when it is not,
 *  then verify with a third call. */
async function robotLoop(client, target, iteration) {
	const startedAt = performance.now();
	let bytes = 0;
	const observed = await client.callTool("get_app_state", { app: APP });
	bytes += contentBytes(observed);
	const observePayload = payload(observed).json;
	const element = (observePayload?.elements ?? []).find(
		(candidate) => String(candidate.id) === String(target.elementIndex),
	);
	if (element === undefined) throw new Error(`robot loop could not find element ${target.elementIndex} in the tree`);
	const pressable = Array.isArray(element.actions) && element.actions.includes("AXPress");

	const clicked = await client.callTool(
		"click",
		pressable
			? { app: APP, observation_token: observePayload.observation_token, element_index: String(target.elementIndex) }
			: {
					app: APP,
					observation_token: observePayload.observation_token,
					x: element.frame.x + element.frame.width / 2,
					y: element.frame.y + element.frame.height / 2,
				},
	);
	bytes += contentBytes(clicked);
	const clickPayload = payload(clicked).json;

	let token = clickPayload?.observation_token;
	let verifyPayload;
	if (token === undefined) {
		const refreshed = await client.callTool("get_app_state", { app: APP });
		bytes += contentBytes(refreshed);
		token = payload(refreshed).json?.observation_token;
	}
	if (token !== undefined) {
		const verified = await client.callTool("verify_state", {
			app: APP,
			observation_token: token,
			checks: [{ element_index: String(target.elementIndex), exists: true }],
		});
		bytes += contentBytes(verified);
		verifyPayload = payload(verified).json;
	}
	return {
		iteration,
		approach: "robot",
		milliseconds: Math.round(performance.now() - startedAt),
		bytes,
		calls: 3,
		clickRoute: pressable ? "accessibility" : "coordinates",
		elementIndex: element?.id,
		verified: verifyPayload?.verified === true,
		dispatched: clickPayload?.actionDispatched === true,
	};
}

/** The strategic path: one call describes the element; the driver resolves, waits, clicks, verifies. */
async function strategicPath(client, target, iteration) {
	const startedAt = performance.now();
	let bytes = 0;
	const clicked = await client.callTool("click_target", {
		app: APP,
		query: target.query,
		index: target.index,
		timeout_ms: 3_000,
		expect: { checks: [{ element_index: String(target.elementIndex), exists: true }] },
	});
	bytes += contentBytes(clicked);
	const clickPayload = payload(clicked).json;
	return {
		iteration,
		approach: "strategic",
		milliseconds: Math.round(performance.now() - startedAt),
		bytes,
		calls: 1,
		clickRoute: clickPayload?.route ?? "none",
		elementIndex: clickPayload?.target?.element_index,
		verified: clickPayload?.verification?.verified === true,
		dispatched: clickPayload?.actionDispatched === true,
	};
}

function median(values) {
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length === 0 ? 0 : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarize(runs) {
	const group = (approach) => {
		const subset = runs.filter((run) => run.approach === approach);
		return {
			runs: subset.length,
			verified: subset.filter((run) => run.verified).length,
			dispatched: subset.filter((run) => run.dispatched).length,
			medianMs: median(subset.map((run) => run.milliseconds)),
			medianBytes: median(subset.map((run) => run.bytes)),
			elementIndexes: [...new Set(subset.map((run) => String(run.elementIndex)))],
		};
	};
	return { robot: group("robot"), strategic: group("strategic") };
}

function writeEvidence(evidence) {
	evidence.finishedAt = new Date().toISOString();
	const outPath = path.isAbsolute(OUT) ? OUT : path.join(REPO, OUT);
	mkdirSync(path.dirname(outPath), { recursive: true });
	writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`);
	console.log(`\nevidence: ${outPath}`);
	if (evidence.bench === undefined) return;
	const benchPath = path.isAbsolute(BENCH_OUT) ? BENCH_OUT : path.join(REPO, BENCH_OUT);
	mkdirSync(path.dirname(benchPath), { recursive: true });
	writeFileSync(
		benchPath,
		`${JSON.stringify({ startedAt: evidence.startedAt, finishedAt: evidence.finishedAt, server: evidence.server, spawnedVia: evidence.spawnedVia, app: evidence.app, target: evidence.target, bench: evidence.bench }, null, 2)}\n`,
	);
	console.log(`bench:    ${benchPath}`);
}

main().catch((error) => {
	console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
	process.exit(1);
});

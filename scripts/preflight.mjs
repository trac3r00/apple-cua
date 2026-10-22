#!/usr/bin/env node
/**
 * apple-cua release gate for docs/expectations/parallel-background-cua.md (EXP-001..EXP-019).
 *
 * Usage:   node scripts/preflight.mjs [--plan] [--no-native] [--only ID[,ID...]] [--help]
 * Needs:   node >= 20, pnpm, git; macOS with the built signed helper for the native check.
 * Network: none. Side effects: `pnpm build` rewrites packages/{core,mcp,browser}/dist (declared generated
 *          output, excluded from the candidate digest); the native check launches the built helper, calls only
 *          read-only tools (get_capabilities, list_apps) and touches the mtime (not the content) of
 *          packages/mcp/dist/server-info.js to trigger one supervised restart.
 * Budget:  every command has its own deadline (see CHECKS); the whole run stays under 25 minutes.
 * Output:  one line per obligation: ID STATUS evidence -- reason, then a summary.
 * Exit:    0 every mandatory obligation PASS; 1 any FAIL; 2 nothing failed but something is BLOCKED (missing tool,
 *          stale source map, unreviewed change, native check not run, --plan); 64 usage error.
 * No waivers: the project defines no exception policy, so no obligation can be WAIVED.
 * No human approval obligation applies: every EXP in the contract has a deterministic verifier.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, utimesSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Release base the scope review was made against. */
export const BASE = "75eaa4d";

/**
 * Authoritative intent sources and the SHA-256 of their bytes when the map below was derived. A change means the map
 * must be re-read and reconciled by a person; never refresh these to turn the gate green. `null` records a source
 * that was absent at review time; its appearance is itself a change to reconcile.
 */
export const SOURCES = {
	"docs/expectations/parallel-background-cua.md": "c7077aab8d575c14ebb4f72e98a8f18e67afd3e36ff00e1402c30c45ed5284ec",
	"AGENTS.md": "a85dbbd04d0778b58d207e9a52a0c84826ac8a6440b73ae616320d67941ccf53",
	"README.md": "c520ee08cca6b60f50c7cf5111d7ce065a5c95faa621d6098815c8eb02b578b0",
	"package.json": "da53bd76e546b956cc3588812d516d762032c914c75e956e833ace059a365350",
	".github/workflows/ci.yml": "1a95756e6508b82e0aa14352585295daf4e7d7fb5ea7c6ccb8706c7ac322e329",
	"Rules.md": null,
	"ROADMAP.md": null,
};

/**
 * Behavior inventory reviewed for this release: every file the change set touches, with its reviewed content hash.
 * Any other changed file since BASE, or a different hash here, blocks until the inventory is reconciled.
 */
export const REVIEWED = {
	"docs/expectations/parallel-background-cua.md": "c7077aab8d575c14ebb4f72e98a8f18e67afd3e36ff00e1402c30c45ed5284ec",
	"package.json": "da53bd76e546b956cc3588812d516d762032c914c75e956e833ace059a365350",
	"packages/browser/extension/DESIGN.md": "548fba1c6c57072519db6e4750e66fa8fce39184aa4d8fc98b3f8d989ed21725",
	"packages/browser/extension/background.js": "b56fd385dd65a27dc039d13ea780b6fc0a8b027e308e061d42ac28270d4a735b",
	"packages/browser/extension/manifest.json": "2f72c9562b550f8b0cb8abf2ae216f9eab69293abbdcdcd2661a373f926d678c",
	"packages/browser/extension/options.html": "db25d68d5290b7caab7762459869aa5d40952cadbb8eae9530f7ede9b025ca42",
	"packages/browser/extension/options.js": "d22b2ba8323cba46e68f244405952e3def7f044b6128d28f9bd8958074f64987",
	"packages/browser/extension/popup.html": "ef31a4973bcdba5769e650e63e8f717933dd778396a926f90f8db936065db64d",
	"packages/browser/extension/popup.js": "c2408cf48b2b62da81ec035a7417ca458135d957b0b2b956253b13d3ce1e2882",
	"packages/browser/src/background.test.ts": "cffc768cc5df24af9357fef501e0009b9e6c1f359615ecf8cdab3862d38c4e78",
	"packages/browser/src/bridge.test.ts": "11ca684ed5e13b36811cf9d73b1c82d6e7a43d8c954ad9f2c65b67dee3edb1dc",
	"packages/browser/src/bridge.ts": "637f2920be6b090957b3c5ca322d914ea50fb2464e5d6c19ce514ca773485bfc",
	"packages/browser/src/connection-options.test.ts":
		"a8305eefc068ec07f55db699de4abf2b9bc4f2ec9733c51b31a1a44922b8f5a7",
	"packages/browser/src/controller.test.ts": "f6371d3e680e5b7bcd1ee2a6559206027d78b4d2c264c05104042b6ba925ef0e",
	"packages/browser/src/controller.ts": "4ae324891e547618c0b20716e6530e39c78be21d8a62aa9ce82a5f40bd37d69a",
	"packages/browser/src/protocol.ts": "a1ad4d590478f87889813b20c3bf0773caa977f92d2841242fe28c0875ffa42b",
	"packages/browser/src/server.test.ts": "620aabccbe54296d972eb02a835b2ba466c11413116506774961684a7fa4530b",
	"packages/browser/src/server.ts": "12c49b087cdb9dc1f22f6d0288fea44cb08f77a1ffc6bd010e8f23c7f7debdeb",
	"packages/core/src/platform/macos-open-app.test.ts":
		"485afbce64f5305298ef2693ed273552da153a457482434dff8c6d074847457b",
	"packages/core/src/platform/macos-open-app.ts": "112501e5a151b0ac69c907ac9d42332a9c4da93010c7e8ef8a30bc12f8aa0a79",
	"packages/mcp/src/capability-tools.ts": "f3dacaf3bf4e217c4b91569756f8bb885a543bf28ea1b62a62001a69433eea1d",
	"packages/mcp/src/compact-schema.protocol.test.ts":
		"def31b835e442f6b09054a73fe3f5c255a50771c3e190f0aef493837e46efa68",
	"packages/mcp/src/desktop-mutation-tools.ts": "c87adc9015eb30d637aa906061c9bae16d1446089006692acc008010a290ee84",
	"packages/mcp/src/host-awareness.protocol.test.ts":
		"9eb8a589f9d41c1bc86ce24cdb53786fd939325e294b18cae0bfe0de5a623cfd",
	"packages/mcp/src/host-detection.test.ts": "245aee739e328d9283ce961dd337825d480b822eff037bc64f28dbedfa5c05c4",
	"packages/mcp/src/host-detection.ts": "fbc651f5f92aaa1065ab59d649b1a935469be741f6ce4f0803f5a128b35b0106",
	"packages/mcp/src/human-tools.ts": "5b29b4615dbb66623f75cd48796ec2c8949e22014d17b3e3fc01f45f2844b411",
	"packages/mcp/src/parallel-tools.ts": "72cc097dd849109a386639e5665ed7821ec33e081e4ed7c1a90e57ec2495c625",
	"packages/mcp/src/power-tools.ts": "2327ccbc90c88c462732bdbd0939c4029624bcef215c56bdd772b1ce25cdd806",
	"packages/mcp/src/protocol-client-harness.ts": "cd356aa5a4b0c2ba5e04bb3f71fe1aa48c74aacbe8fb76ccc12557c96927dd19",
	"packages/mcp/src/script-tools.ts": "bba06094500e0d127bd761c901026873ec175ce5d635c85a3f81f9006faf7160",
	"packages/mcp/src/server.ts": "69dda61f50b8ef346576f264234fd4e5837cdc4a0e0b7699d9360504bc122875",
	"packages/mcp/src/supervisor-framing.property.test.ts":
		"bc6864edc61e2554aa9685fdef1135cd3b9d306c4874239c47aeb168c9b11c6b",
	"packages/mcp/src/supervisor.test.ts": "fffa1d65aee5895d544cc44422356010139c59321d9fd7274b12d183cf6cd8d8",
	"packages/mcp/src/supervisor.ts": "ae9cd0f72ad535342fea7e563c730e4437edfe556a3c9a46c071822095284140",
	"packages/mcp/src/tool-schemas.ts": "4babd152f791d1e1cdd9e0d7f1f4621fdff8ef8558e6c0ce23de2351518bf919",
	"packages/mcp/src/visual-tools.ts": "8317b0c4568c3096105512aa9ad3eae5563c69ec6f888bd9d1dcbd1ffb32b7e6",
	"packages/mcp/src/worker-coordinator.test.ts": "e5c4d31e3c6fca79dbcf428022a7b4e957d209fe59964d9009de0ddd0fcb5020",
	"packages/mcp/src/worker-coordinator.ts": "1f54bb061c39ed40c66ad476ef18f61f7c99d3c655be1f507a3e4d371d00fd59",
	"packages/mcp/src/worker-tools.protocol.test.ts": "b8b85cacbacf0a47279c34781a8745073cd491976292d006de46692b343ddafc",
	"packages/mcp/src/worker-tools.ts": "11f9f785365c619da91d6691dab3e3d3e2489af0f6193410b38083a51179759c",
	"skills/apple-cua-browser/SKILL.md": "d1ac6edea3a76f00de07ac67a640f8652d50836cd1b058101e19d9ed47547959",
	"skills/apple-cua/SKILL.md": "0ed488c936614efef05f9298f41e7c7c6680238b296dd78a51c54aa3bb3bdddb",
	"skills/apple-cua/references/workflow-patterns.md":
		"c1a96763ed1009484fb51ff7b4863a4439067fad183ae6e63037d10d38475200",
};

/** Generated outputs the gate itself produces or the build writes; excluded from scope and candidate digests. */
const GENERATED = [/(^|\/)dist\//, /(^|\/)node_modules\//, /^\.omo\//, /^\.bench\//, /^\.gstack\//];

const vitest = (files) => ({ argv: ["pnpm", "exec", "vitest", "--run", ...files], timeoutMs: 300_000 });

/** Mapped obligations. Each verifier is an explicit argv run in REPO, or a named built-in check. */
export const CHECKS = [
	{ id: "INT-TOOLS", source: "AGENTS.md (pnpm workspace, node)", builtin: "tools" },
	{ id: "INT-SOURCES", source: "contract + project instructions", builtin: "sources" },
	{ id: "INT-SCOPE", source: "contract Work plan (reviewed inventory)", builtin: "scope" },
	{
		id: "EXP-001",
		source: "contract EXP-001",
		...vitest(["packages/mcp/src/host-detection.test.ts", "packages/mcp/src/host-awareness.protocol.test.ts"]),
	},
	{ id: "EXP-002", source: "contract EXP-002", ...vitest(["packages/mcp/src/host-awareness.protocol.test.ts"]) },
	{
		id: "EXP-003",
		source: "contract EXP-003",
		...vitest(["packages/mcp/src/worker-tools.protocol.test.ts", "packages/mcp/src/worker-coordinator.test.ts"]),
	},
	{ id: "EXP-004", source: "contract EXP-004", ...vitest(["packages/mcp/src/worker-tools.protocol.test.ts"]) },
	{ id: "EXP-005", source: "contract EXP-005", ...vitest(["packages/mcp/src/compact-schema.protocol.test.ts"]) },
	...["EXP-006", "EXP-007", "EXP-008", "EXP-009"].map((id) => ({
		id,
		source: `contract ${id}`,
		...vitest([
			"packages/browser/src/bridge.test.ts",
			"packages/browser/src/controller.test.ts",
			"packages/browser/src/server.test.ts",
			"packages/browser/src/background.test.ts",
			"packages/browser/src/connection-options.test.ts",
		]),
	})),
	{ id: "EXP-010", source: "contract EXP-010", ...vitest(["packages/core/src/platform/macos-open-app.test.ts"]) },
	...["EXP-011", "EXP-012", "EXP-013", "EXP-014", "EXP-015"].map((id) => ({
		id,
		source: `contract ${id}`,
		...vitest(["packages/mcp/src/supervisor.test.ts"]),
	})),
	{ id: "EXP-019-BUILD", source: "contract EXP-019", argv: ["pnpm", "build"], timeoutMs: 600_000 },
	{ id: "EXP-016", source: "contract EXP-016 (signed helper)", builtin: "native", timeoutMs: 60_000 },
	{
		id: "EXP-017",
		source: "contract EXP-017 (FDD)",
		...vitest(["packages/mcp/src/supervisor-framing.property.test.ts"]),
	},
	{
		id: "EXP-018",
		source: "contract EXP-018",
		argv: ["node", "--test", "scripts/preflight.test.mjs"],
		timeoutMs: 300_000,
	},
	{ id: "EXP-019-LINT", source: "contract EXP-019", argv: ["pnpm", "exec", "biome", "ci", "."], timeoutMs: 120_000 },
	{ id: "EXP-019-TYPES", source: "contract EXP-019", argv: ["pnpm", "-r", "typecheck"], timeoutMs: 300_000 },
	{
		id: "EXP-019-TEST-TYPES",
		source: "contract EXP-019",
		argv: ["pnpm", "typecheck:tests"],
		timeoutMs: 300_000,
	},
	{ id: "EXP-019-TESTS", source: "contract EXP-019", argv: ["pnpm", "exec", "vitest", "--run"], timeoutMs: 900_000 },
	{ id: "EXP-019-SCRIPTS", source: "contract EXP-019", argv: ["pnpm", "test:scripts"], timeoutMs: 300_000 },
];

export function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

export function parseArgs(argv) {
	const options = { plan: false, native: true, only: undefined, help: false };
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--plan") options.plan = true;
		else if (arg === "--no-native") options.native = false;
		else if (arg === "--help" || arg === "-h") options.help = true;
		else if (arg === "--only") {
			const value = argv[++index];
			if (value === undefined || value.trim() === "") throw new Error("--only needs a comma-separated ID list");
			options.only = value.split(",").map((id) => id.trim());
			const known = new Set(CHECKS.map((check) => check.id));
			const unknown = options.only.filter((id) => !known.has(id));
			if (unknown.length > 0) throw new Error(`unknown check id: ${unknown.join(", ")}`);
		} else throw new Error(`unknown argument: ${arg}`);
	}
	return options;
}

/** 0 only when every result passed; any FAIL beats BLOCKED; anything else is incomplete coverage. */
export function exitCode(results) {
	if (results.length === 0) return 2;
	if (results.some((result) => result.status === "FAIL")) return 1;
	if (results.some((result) => result.status !== "PASS")) return 2;
	return 0;
}

/** Compare authoritative sources with the fingerprints the map was derived from. */
export function checkSources(root, expected = SOURCES) {
	const stale = [];
	for (const [path, hash] of Object.entries(expected)) {
		const full = join(root, path);
		const present = existsSync(full);
		if (hash === null) {
			if (present) stale.push(`${path} appeared`);
		} else if (!present) stale.push(`${path} missing`);
		else if (sha256(readFileSync(full)) !== hash) stale.push(`${path} changed`);
	}
	return stale.length === 0
		? { status: "PASS", evidence: `${Object.keys(expected).length} sources match` }
		: { status: "BLOCKED", evidence: stale.join("; "), reason: "stale source map: re-read and reconcile" };
}

/** Changed files since base (tracked diff plus untracked), minus generated outputs and the gate itself. */
export function isScopeFile(path) {
	return !GENERATED.some((pattern) => pattern.test(path)) && !path.startsWith("scripts/preflight");
}

export function checkScope(root, changed, reviewed) {
	const problems = [];
	for (const path of changed.filter(isScopeFile)) {
		const want = reviewed[path];
		if (want === undefined) problems.push(`unreviewed ${path}`);
		else {
			const full = join(root, path);
			const have = existsSync(full) ? sha256(readFileSync(full)) : "deleted";
			if (have !== want) problems.push(`changed since review ${path}`);
		}
	}
	return problems.length === 0
		? { status: "PASS", evidence: `${changed.filter(isScopeFile).length} changed files match the reviewed inventory` }
		: {
				status: "BLOCKED",
				evidence: problems.slice(0, 8).join("; "),
				reason: "implementation changed since scope review",
			};
}

/** Run argv with a deadline; the child's process group is killed on timeout or on our own termination. */
export function run(argv, { cwd = REPO, timeoutMs, env = process.env } = {}) {
	return new Promise((resolveRun) => {
		const child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
		let output = "";
		const keep = (chunk) => {
			output = (output + chunk.toString("utf8")).slice(-4000);
		};
		child.stdout.on("data", keep);
		child.stderr.on("data", keep);
		const kill = () => {
			try {
				process.kill(-child.pid, "SIGKILL");
			} catch {}
		};
		owned.add(kill);
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			kill();
		}, timeoutMs);
		child.once("error", (error) => {
			clearTimeout(timer);
			owned.delete(kill);
			resolveRun({ code: null, timedOut: false, output: error.message, missing: error.code === "ENOENT" });
		});
		child.once("close", (code) => {
			clearTimeout(timer);
			owned.delete(kill);
			resolveRun({ code, timedOut, output, missing: false });
		});
	});
}

const owned = new Set();
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
	process.once(signal, () => {
		for (const kill of owned) kill();
		process.exit(2);
	});
}

async function git(args) {
	const result = await run(["git", ...args], { timeoutMs: 30_000 });
	if (result.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.output.trim()}`);
	return result.output;
}

export async function changedFiles() {
	const tracked = await git(["diff", "--name-only", BASE]);
	const untracked = await git(["ls-files", "--others", "--exclude-standard"]);
	return [...new Set(`${tracked}\n${untracked}`.split("\n").filter((line) => line.trim() !== ""))].sort();
}

/** Identity of the tested bytes: HEAD plus the content of every non-generated changed file. */
export async function candidateDigest() {
	const head = (await git(["rev-parse", "HEAD"])).trim();
	const hash = createHash("sha256").update(head);
	for (const path of (await changedFiles()).filter(isScopeFile)) {
		const full = join(REPO, path);
		hash.update(`\0${path}\0${existsSync(full) ? sha256(readFileSync(full)) : "deleted"}`);
	}
	return { head, digest: hash.digest("hex") };
}

async function checkTools() {
	const missing = [];
	for (const argv of [
		["node", "--version"],
		["pnpm", "--version"],
		["git", "--version"],
	]) {
		const result = await run(argv, { timeoutMs: 30_000 });
		if (result.code !== 0) missing.push(argv[0]);
	}
	const major = Number(process.versions.node.split(".")[0]);
	if (major < 20) missing.push(`node>=20 (have ${process.versions.node})`);
	return missing.length === 0
		? { status: "PASS", evidence: `node ${process.versions.node}, pnpm, git` }
		: { status: "BLOCKED", evidence: missing.join(", "), reason: "required tool missing" };
}

/** Real chain: signed helper -> supervisor -> child. Read-only tools only. */
async function checkNative(timeoutMs) {
	const helper = join(REPO, "packages/mcp/dist/apple-cua-mcp.app/Contents/MacOS/apple-cua-mcp");
	const script = join(REPO, "packages/mcp/dist/server.js");
	if (process.platform !== "darwin" || !existsSync(helper) || !existsSync(script)) {
		return { status: "BLOCKED", evidence: helper, reason: "signed helper or build missing (macOS only)" };
	}
	const child = spawn(helper, [script], {
		stdio: ["pipe", "pipe", "ignore"],
		env: { ...process.env, APPLE_CUA_TOOLSET: "full", APPLE_CUA_DELIVERY: "background" },
	});
	const messages = [];
	const waiters = [];
	let buffer = "";
	child.stdout.on("data", (chunk) => {
		buffer += chunk.toString("utf8");
		for (let index = buffer.indexOf("\n"); index >= 0; index = buffer.indexOf("\n")) {
			const message = JSON.parse(buffer.slice(0, index));
			buffer = buffer.slice(index + 1);
			messages.push(message);
			for (const waiter of [...waiters]) if (waiter.match(message)) waiter.done(message);
		}
	});
	const deadline = Date.now() + timeoutMs;
	const until = (match) => {
		const hit = messages.find(match);
		if (hit !== undefined) return Promise.resolve(hit);
		return new Promise((resolveWait, rejectWait) => {
			const timer = setTimeout(
				() => rejectWait(new Error("native check deadline")),
				Math.max(deadline - Date.now(), 1),
			);
			waiters.push({
				match,
				done: (message) => {
					clearTimeout(timer);
					waiters.splice(
						waiters.findIndex((waiter) => waiter.match === match),
						1,
					);
					resolveWait(message);
				},
			});
		});
	};
	let id = 0;
	const call = (method, params) => {
		const requestId = ++id;
		child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })}\n`);
		return until((message) => message.id === requestId);
	};
	const listChanged = () => messages.filter((message) => message.method === "notifications/tools/list_changed").length;
	const kill = () => child.kill("SIGKILL");
	owned.add(kill);
	try {
		const init = await call("initialize", {
			protocolVersion: "2025-06-18",
			capabilities: {},
			clientInfo: { name: "apple-cua-preflight", version: "1" },
		});
		child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
		if (init.result?.capabilities?.tools?.listChanged !== true) {
			return { status: "FAIL", evidence: "initialize", reason: "listChanged not advertised" };
		}
		const capabilities = async () =>
			JSON.parse((await call("tools/call", { name: "get_capabilities", arguments: {} })).result.content[0].text);
		const before = await capabilities();
		const permissions = JSON.stringify(before.permissions);
		const seen = listChanged();
		const now = new Date();
		utimesSync(join(REPO, "packages/mcp/dist/server-info.js"), now, now);
		await until(() => listChanged() > seen);
		const after = await capabilities();
		const apps = await call("tools/call", { name: "list_apps", arguments: {} });
		if (JSON.stringify(after.permissions) !== permissions || apps.result?.isError === true) {
			return { status: "FAIL", evidence: `permissions ${permissions} -> ${JSON.stringify(after.permissions)}` };
		}
		child.stdin.end();
		const code = await new Promise((resolveExit) => child.once("exit", resolveExit));
		return code === 0
			? { status: "PASS", evidence: `helper chain served, restarted on build change, permissions ${permissions}` }
			: { status: "FAIL", evidence: `supervisor exit ${code}`, reason: "unclean shutdown" };
	} catch (error) {
		return { status: "FAIL", evidence: error instanceof Error ? error.message : String(error) };
	} finally {
		owned.delete(kill);
		if (child.exitCode === null) kill();
	}
}

async function evaluate(check, options, inventory) {
	if (check.builtin === "tools") return checkTools();
	if (check.builtin === "sources") return checkSources(REPO);
	if (check.builtin === "scope") return checkScope(REPO, inventory, REVIEWED);
	if (check.builtin === "native") {
		return options.native
			? checkNative(check.timeoutMs)
			: { status: "BLOCKED", evidence: "--no-native", reason: "native chain not checked" };
	}
	const result = await run(check.argv, { timeoutMs: check.timeoutMs });
	if (result.missing) return { status: "BLOCKED", evidence: check.argv[0], reason: "command not found" };
	if (result.timedOut)
		return { status: "FAIL", evidence: check.argv.join(" "), reason: `timed out after ${check.timeoutMs} ms` };
	if (result.code === 0) return { status: "PASS", evidence: check.argv.join(" ") };
	const tail = result.output.trim().split("\n").slice(-3).join(" | ");
	return { status: "FAIL", evidence: check.argv.join(" "), reason: `exit ${result.code}: ${tail}` };
}

function print(id, result) {
	process.stdout.write(`${id} ${result.status} ${result.evidence}${result.reason ? ` -- ${result.reason}` : ""}\n`);
}

async function main() {
	let options;
	try {
		options = parseArgs(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exit(64);
	}
	if (options.help) {
		process.stdout.write(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
		process.exit(0);
	}
	const selected = options.only === undefined ? CHECKS : CHECKS.filter((check) => options.only.includes(check.id));
	if (options.plan) {
		for (const check of selected)
			print(check.id, { status: "NOT CHECKED", evidence: check.source, reason: "plan only" });
		process.stdout.write("SUMMARY plan only: readiness NOT CHECKED\n");
		process.exit(2);
	}
	const start = await candidateDigest();
	const inventory = await changedFiles();
	process.stdout.write(`CANDIDATE head=${start.head} digest=${start.digest} base=${BASE}\n`);
	const results = [];
	for (const check of selected) {
		const result = await evaluate(check, options, inventory);
		print(check.id, result);
		results.push(result);
	}
	const end = await candidateDigest();
	if (end.digest !== start.digest) {
		const result = {
			status: "FAIL",
			evidence: `${start.digest} -> ${end.digest}`,
			reason: "candidate changed during check",
		};
		print("INT-CANDIDATE", result);
		results.push(result);
	}
	const count = (status) => results.filter((result) => result.status === status).length;
	const code = exitCode(results);
	process.stdout.write(
		`SUMMARY pass=${count("PASS")} fail=${count("FAIL")} blocked=${count("BLOCKED")} waived=0 exit=${code}\n`,
	);
	process.exit(code);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}

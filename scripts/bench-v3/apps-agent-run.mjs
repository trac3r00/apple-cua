#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	closeSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	readdirSync,
	readlinkSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isScreenLocked } from "../../packages/core/dist/platform/macos-ffi/lock-screen.js";
import { desktopProbe } from "../bench-v2/desktop.mjs";
import { ROOT, TARGET } from "../bench-v2/fixture.mjs";
import { AGENT_MODEL, AGENT_REASONING, AGENT_TIMEOUT_MS, matchedAgentModel, runAgentRoute } from "./agents.mjs";
import { startDisturbance } from "./disturbance.mjs";
import { expectFile } from "./file-oracle.mjs";
import { startPages } from "./pages.mjs";
import { mulberry32, shuffle } from "./stats.mjs";
import { subscribeWindow } from "./window-event.mjs";
import { subscribeSurface } from "./window-surface-event.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
export const APP_AGENT_ROUTES = Object.freeze([
	"omo-apple",
	"omo-cua",
	"omo-native",
	"codex-apple",
	"codex-cua",
	"codex-native",
]);
export const APP_AGENT_TASKS = Object.freeze(["clipboard-cross-app", "textedit-save-sheet"]);
export const APP_AGENT_GOALS = Object.freeze({
	"clipboard-cross-app": (url) =>
		`Copy the entire text of the TextEdit document document.txt and paste it into the field labeled "Code" on the page ${url} that is open in Safari. Do not submit the page.`,
	"textedit-save-sheet": () =>
		`In TextEdit, create a new plain-text document containing exactly "${TARGET}" and save it as ${ROOT}/saved-from-sheet.txt using TextEdit's Save dialog.`,
});
export const APP_AGENT_TIMEOUT_SECONDS = AGENT_TIMEOUT_MS / 1000;
export const SAFARI_FIXTURE_POLICY =
	"T4 v3 isolated directory and exact-path AXDocument/PID/window ownership; exact loopback Safari model/AX ownership; subscribed surface closure; T5 unavailable.";
const AUXILIARY_BUNDLES = [
	"com.apple.appkit.xpc.ThemeWidgetControlViewService",
	"com.apple.TextInputUI.xpc.CursorUIViewService",
	"com.apple.textkit.nsattributedstringagent",
];

export function assertTaskAvailable(task) {
	if (task === "textedit-save-sheet")
		throw new Error("T5 unavailable: unsaved document ownership evidence contract is unresolved");
}

export function assertFixturePolicy(report, policy) {
	if (JSON.stringify(report.fixture_provenance) !== JSON.stringify(policy))
		throw new Error("old or changed fixture provenance refused before recovery; retain historical raw output");
}

function fixtureProvenance() {
	const sources = [
		"scripts/bench-v3/apps-agent-run.mjs",
		"scripts/bench-v3/ax-document-identity.swift",
		"scripts/bench-v3/ax-window-inventory.swift",
		"scripts/bench-v3/window-surface-event.swift",
		"scripts/bench-v3/window-surface-event.mjs",
		"scripts/bench-v3/window-event.swift",
		"scripts/bench-v3/agents.mjs",
		"scripts/bench-v3/pages.mjs",
		"scripts/bench-v3/disturbance.swift",
		"scripts/bench-v3/disturbance.mjs",
		"scripts/bench-v3/window-event.mjs",
		"scripts/bench-v2/desktop.mjs",
		"scripts/bench-v2/desktop-state.swift",
		"scripts/bench-v2/clipboard.swift",
		"packages/core/dist/platform/macos.js",
		"packages/mcp/dist/server.js",
	];
	return {
		revision: SAFARI_FIXTURE_POLICY,
		source_hashes: Object.fromEntries(
			sources.map((path) => [
				path,
				createHash("sha256")
					.update(readFileSync(`${root}/${path}`))
					.digest("hex"),
			]),
		),
	};
}

export function validateDocumentIdentity(evidence, owned, present) {
	const ids = evidence.matched_window_ids;
	if (
		evidence.pid !== owned.pid ||
		evidence.bundle !== owned.bundle ||
		evidence.unknown_document_windows !== 0 ||
		!Array.isArray(ids) ||
		evidence.status !== (present ? "matched" : "no_match") ||
		ids.length !== (present ? 1 : 0) ||
		(present && (!Number.isInteger(ids[0]) || ids[0] < 1 || (owned.number && ids[0] !== owned.number)))
	)
		throw new Error("exact AXDocument identity unavailable, unknown or ambiguous");
	return present ? ids[0] : null;
}

function validateInventory(evidence, owned) {
	if (
		evidence.pid !== owned.pid ||
		evidence.bundle !== owned.bundle ||
		!Array.isArray(evidence.ax_window_ids) ||
		evidence.ax_window_ids.some((id) => !Number.isInteger(id) || id < 1) ||
		new Set(evidence.ax_window_ids).size !== evidence.ax_window_ids.length
	)
		throw new Error("successful exact AXWindows inventory required");
	return evidence.ax_window_ids;
}

function safariAbsent(snapshot, evidence) {
	if (
		!evidence ||
		evidence.bundle !== "com.apple.Safari" ||
		!Number.isInteger(evidence.pid) ||
		evidence.pid < 1 ||
		evidence.modelPid !== evidence.pid ||
		!Array.isArray(evidence.model) ||
		evidence.model.some(
			(model) =>
				!Number.isInteger(model.number) || model.number < 1 || model.visible !== false || model.tabCount !== 0,
		) ||
		new Set(evidence.model.map((model) => model.number)).size !== evidence.model.length
	)
		return false;
	const apps = snapshot.apps.filter((app) => app.bundle === evidence.bundle);
	if (apps.length !== 1 || apps[0].pid !== evidence.pid) return false;
	try {
		if (validateInventory(evidence.inventory, evidence).length !== 0) return false;
	} catch {
		return false;
	}
	return true;
}

function retiredSafariSurface(snapshot, window, evidence) {
	return (
		safariAbsent(snapshot, evidence) &&
		window.owner === "Safari" &&
		window.pid === evidence.pid &&
		Number.isInteger(window.number) &&
		window.number > 0 &&
		window.onScreen === false &&
		snapshot.windows.filter((surface) => surface.number === window.number).length === 1
	);
}

function textEditAbsent(snapshot, evidence) {
	if (
		evidence?.bundle !== "com.apple.TextEdit" ||
		evidence.modelPid !== evidence.pid ||
		evidence.documentCount !== 0 ||
		snapshot.apps.filter((app) => app.bundle === evidence.bundle && app.pid === evidence.pid).length !== 1
	)
		return false;
	try {
		return validateInventory(evidence.inventory, evidence).length === 0;
	} catch {
		return false;
	}
}

export function assertFixtureWindowPreflight(snapshot, t4, safari, textEdit) {
	// Model/AX evidence is mandatory even when WindowServer lists no Safari surfaces.
	if (t4 && snapshot.apps.some((app) => app.bundle === "com.apple.Safari")) {
		if (!safariAbsent(snapshot, safari)) throw new Error("live or unknown Safari model/AX inventory refused");
	}
	const emptyTextEdit = textEditAbsent(snapshot, textEdit);
	if (snapshot.apps.some((app) => app.bundle === "com.apple.TextEdit") && !emptyTextEdit)
		throw new Error("live or unknown TextEdit model/AX inventory refused");
	if (
		snapshot.windows.some(
			(window) =>
				(["document.txt", "other.txt", "saved-from-sheet.txt", "Untitled"].includes(window.title) ||
					(t4 && window.owner === "Safari")) &&
				!retiredSafariSurface(snapshot, window, safari) &&
				!(
					emptyTextEdit &&
					window.pid === textEdit.pid &&
					window.owner === "TextEdit" &&
					Number.isInteger(window.number) &&
					window.number > 0 &&
					window.onScreen === false &&
					snapshot.windows.filter((surface) => surface.number === window.number).length === 1
				),
		)
	)
		throw new Error("pre-existing fixture window refused; T4 requires no existing Safari windows");
}

export function refreshCleanupClosures(rows, current, evidence) {
	const owned = new Map();
	for (const row of [...rows, current])
		for (const closure of row.closure_evidence ?? [])
			if (closure.closed === true) owned.set(`${closure.pid}:${closure.number}`, closure);
	return [...owned.values()].map((closure) => ({ ...closure, ...evidence(closure) }));
}

export function fixtureWindowLeftovers(snapshot, initialWindowNumbers, safari, closures, auxiliary = []) {
	return snapshot.windows
		.filter((window) => !initialWindowNumbers.has(window.number))
		.filter((window) => {
			if (retiredSafariSurface(snapshot, window, safari)) return false;
			const service = auxiliary.find(
				(item) =>
					item.pid === window.pid &&
					AUXILIARY_BUNDLES.includes(item.bundle) &&
					snapshot.apps.filter((app) => app.pid === item.pid && app.bundle === item.bundle).length === 1,
			);
			if (
				service &&
				Number.isInteger(window.number) &&
				window.number > 0 &&
				window.onScreen === false &&
				snapshot.windows.filter((surface) => surface.number === window.number).length === 1
			) {
				try {
					if (validateInventory(service, service).length === 0) return false;
				} catch {
					// Unavailable independent evidence retains the unexpected surface.
				}
			}
			const closure = closures.find((owned) => owned.pid === window.pid && owned.number === window.number);
			if (!closure) return true;
			try {
				validateOwnedClosure(closure, closure.document, closure.inventory, snapshot.windows, closure.modelCount);
				return false;
			} catch {
				return true;
			}
		})
		.map((window) => `${window.owner}:${window.title}`);
}

function safariInventory(snapshot, binaries) {
	const apps = snapshot.apps.filter((app) => app.bundle === "com.apple.Safari");
	if (apps.length !== 1) return null;
	const owned = apps[0];
	try {
		const result =
			applescript(`tell application "System Events" to set modelPid to unix id of first application process whose bundle identifier is "com.apple.Safari"
tell application "Safari"
set rows to {}
repeat with w in windows
set end of rows to ((id of w as text) & "," & (visible of w as text) & "," & ((count (tabs of w)) as text))
end repeat
set AppleScript's text item delimiters to linefeed
return (modelPid as text) & linefeed & (rows as text)
end tell`);
		const [pid, ...rows] = result.split("\n");
		const model = rows
			.filter((row) => row !== "")
			.map((row) => {
				const [number, visible, tabCount] = row.split(",");
				return {
					number: Number(number),
					visible: visible === "false" ? false : visible === "true" ? true : null,
					tabCount: Number(tabCount),
				};
			});
		return { ...owned, modelPid: Number(pid), model, inventory: nativeEvidence(binaries.inventory, owned) };
	} catch {
		// A failed independent probe stays unknown; it never permits setup or hides a leftover.
		return null;
	}
}

function textEditInventory(snapshot, binaries) {
	const apps = snapshot.apps.filter((app) => app.bundle === "com.apple.TextEdit");
	if (apps.length !== 1) return null;
	const owned = apps[0];
	try {
		const [modelPid, documentCount] =
			applescript(`tell application "System Events" to set modelPid to unix id of first application process whose bundle identifier is "com.apple.TextEdit"
tell application "TextEdit" to set documentCount to count documents
return (modelPid as text) & "," & (documentCount as text)`)
				.split(",")
				.map(Number);
		return { ...owned, modelPid, documentCount, inventory: nativeEvidence(binaries.inventory, owned) };
	} catch {
		return null;
	}
}

export function validateOwnedClosure(owned, document, inventory, windows, modelCount) {
	if (owned.bundle === "com.apple.TextEdit" && !document)
		throw new Error("exact AXDocument absence evidence required");
	if (document) validateDocumentIdentity(document, owned, false);
	const surfaces = windows.filter((window) => window.number === owned.number);
	if (
		modelCount !== 0 ||
		validateInventory(inventory, owned).includes(owned.number) ||
		surfaces.length > 1 ||
		surfaces.some((window) => window.pid !== owned.pid || window.onScreen !== false)
	)
		throw new Error("owned document, AX ID or compositor surface remains");
	return true;
}

const quoted = (text) => `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

export function appsAgentPageUrl(base, slot) {
	return `${base}/page?kind=form&attempt=${slot.iteration}-${slot.route}`;
}

export function appsAgentIterationEnd(runs, startIteration) {
	const endIteration = startIteration + (runs - 1);
	if (
		!Number.isSafeInteger(runs) ||
		runs < 1 ||
		!Number.isSafeInteger(startIteration) ||
		startIteration < 1 ||
		!Number.isSafeInteger(endIteration)
	)
		throw new Error("invalid iteration count, start or end");
	return endIteration;
}

export function parseAppsAgentOptions(args) {
	const value = (name, fallback) => {
		const index = args.indexOf(`--${name}`);
		if (index < 0) return fallback;
		const next = args[index + 1];
		if (!next || next.startsWith("--")) throw new Error(`missing --${name} value`);
		return next;
	};
	const runs = Number(value("runs", "30"));
	const startIteration = Number(value("start-iteration", "1"));
	const seed = Number(value("seed", "20261009"));
	const routes = value("routes", APP_AGENT_ROUTES.join(",")).split(",");
	const tasks = value("tasks", APP_AGENT_TASKS.join(",")).split(",");
	appsAgentIterationEnd(runs, startIteration);
	if (!Number.isInteger(seed)) throw new Error("invalid seed");
	if (
		!routes.length ||
		new Set(routes).size !== routes.length ||
		routes.some((route) => !APP_AGENT_ROUTES.includes(route))
	)
		throw new Error("unsupported agent route selection");
	if (!tasks.length || new Set(tasks).size !== tasks.length || tasks.some((task) => !APP_AGENT_TASKS.includes(task)))
		throw new Error("unsupported task selection");
	return { runs, startIteration, seed, routes, tasks };
}

export function buildAppsAgentSchedule({ runs, startIteration = 1, routes, tasks, seed }) {
	const endIteration = appsAgentIterationEnd(runs, startIteration);
	const random = mulberry32(seed);
	const schedule = [];
	for (let iteration = 1; iteration <= endIteration; iteration++)
		for (const task of shuffle(tasks, random))
			for (const route of shuffle(routes, random))
				if (iteration >= startIteration) schedule.push({ iteration, task, route });
	return schedule;
}

export function pendingAppsAgentSlots(schedule, results) {
	return schedule.filter(
		(slot) =>
			!results.some(
				(row) =>
					row.iteration === slot.iteration &&
					row.task === slot.task &&
					row.route === slot.route &&
					row.interrupted === false,
			),
	);
}

export function combineCleanupErrors(taskFailed, taskError, cleanupErrors, message) {
	return new AggregateError(taskFailed ? [taskError, ...cleanupErrors] : cleanupErrors, message);
}

export function appsAgentOracle(task, state, files) {
	const source = files.source === TARGET;
	const control =
		files.control === "other document unchanged" && files.control_document === "other document unchanged";
	if (task === "clipboard-cross-app" || task === "textedit-two-windows")
		return {
			source_file: source,
			source_document: files.source_document === TARGET,
			control_file: files.control === "other document unchanged",
			control_document: files.control_document === "other document unchanged",
			page_field: task === "clipboard-cross-app" ? state?.field === TARGET : null,
			pass:
				source &&
				files.source_document === TARGET &&
				files.control === "other document unchanged" &&
				files.control_document === "other document unchanged" &&
				(task === "textedit-two-windows" || state?.field === TARGET),
		};
	if (task === "textedit-save-sheet") {
		const saved = files.saved === TARGET;
		return {
			saved_file: saved,
			control_file: files.control === "other document unchanged",
			control_document: files.control_document === "other document unchanged",
			pass: saved && control,
		};
	}
	throw new Error(`unknown apps agent task: ${task}`);
}

export function appsAgentFalseSuccess(result, pass) {
	return result?.result === "DONE" && !pass;
}

export function appsAgentUnsafe(row) {
	const trace = row.disturbance_trace;
	if (row.disturbance_error) return true;
	return (
		row.focus_disturbance !== false ||
		row.pointer_disturbance !== false ||
		!Array.isArray(trace?.activations) ||
		trace.activations.length > 0 ||
		!Number.isFinite(trace.max_cursor_px) ||
		!Number.isFinite(trace.max_appkit_cursor_px) ||
		Math.max(trace.max_cursor_px, trace.max_appkit_cursor_px) > 2
	);
}

export function hasDuplicateMarker(value) {
	return typeof value === "string" && value.split(TARGET).length - 1 > 1;
}

function writeReport(output, report) {
	mkdirSync(resolve(output, ".."), { recursive: true });
	const temporary = `${output}.${process.pid}.tmp`;
	writeFileSync(temporary, JSON.stringify(report, null, 2));
	renameSync(temporary, output);
}

export function prepareFixtureDirectory(rootDir, report, tasks) {
	for (const task of tasks) assertTaskAvailable(task);
	if (!report.fixture_directory) {
		const path = mkdtempSync(`${rootDir}/apps-agent-t4-`);
		const stat = lstatSync(path);
		report.fixture_directory = { path, dev: stat.dev, ino: stat.ino, uid: stat.uid };
	}
	const owned = report.fixture_directory;
	const stat = lstatSync(owned.path, { throwIfNoEntry: false });
	if (
		dirname(owned.path) !== rootDir ||
		!/^apps-agent-t4-[A-Za-z0-9]+$/.test(relative(rootDir, owned.path)) ||
		!stat?.isDirectory() ||
		stat.isSymbolicLink() ||
		stat.uid !== process.getuid() ||
		stat.uid !== owned.uid ||
		stat.dev !== owned.dev ||
		stat.ino !== owned.ino ||
		realpathSync(owned.path) !== owned.path
	)
		throw new Error("unproven or changed fixture directory refused before recovery");
	return { dir: owned.path, lockPath: `${rootDir}/.run.lock` };
}

export function snapshotFixtureFiles(dir, fixtureDir) {
	const ignored = new Set([".run.lock"]);
	for (const name of [
		"document.txt",
		"other.txt",
		"saved-from-sheet.txt",
		"window-event-apps-agent",
		"disturbance-apps-agent",
		"ax-document-identity-apps-agent",
		"ax-window-inventory-apps-agent",
		"window-surface-event-apps-agent",
	])
		ignored.add(relative(dir, `${fixtureDir}/${name}`));
	const snapshot = new Map();
	const visit = (parent, prefix = "") => {
		for (const entry of readdirSync(parent, { withFileTypes: true })) {
			const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (ignored.has(relativePath) || relativePath === "v3/agents" || relativePath.startsWith("v3/agents/"))
				continue;
			const fullPath = `${parent}/${entry.name}`;
			const stat = lstatSync(fullPath);
			if (stat.isSymbolicLink()) snapshot.set(relativePath, `link:${readlinkSync(fullPath)}`);
			else if (stat.isDirectory()) {
				snapshot.set(relativePath, "directory");
				visit(fullPath, relativePath);
			} else if (stat.isFile()) snapshot.set(relativePath, `file:${readFileSync(fullPath).toString("base64")}`);
			else snapshot.set(relativePath, "other");
		}
	};
	visit(dir);
	return snapshot;
}

function changedFixtureFiles(before, after) {
	return [...new Set([...before.keys(), ...after.keys()])]
		.filter((path) => before.get(path) !== after.get(path))
		.sort();
}

function applescript(script) {
	return execFileSync("osascript", ["-e", script], { encoding: "utf8", timeout: 10000 }).trim();
}

function readTextEditDocument(path) {
	return applescript(`tell application "TextEdit"
set matches to every document whose path is ${quoted(path)}
if (count matches) is not 1 then error "Exact document model ambiguous"
return text of item 1 of matches
end tell`).trimEnd();
}

function acquireRunLock(path) {
	let lock;
	let recoveredPid = null;
	try {
		lock = openSync(path, "wx");
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
		const existingPid = Number(readFileSync(path, "utf8").trim());
		if (!Number.isInteger(existingPid) || existingPid < 1)
			throw new Error("benchmark lock is unreadable; refusing to remove it");
		try {
			process.kill(existingPid, 0);
			throw new Error(`benchmark already running with pid ${existingPid}`);
		} catch (probeError) {
			if (probeError.code !== "ESRCH") throw probeError;
		}
		const stalePath = `${path}.stale-${existingPid}-${process.pid}`;
		renameSync(path, stalePath);
		rmSync(stalePath, { force: true });
		recoveredPid = existingPid;
		lock = openSync(path, "wx");
	}
	writeFileSync(lock, `${process.pid}\n`);
	return { lock, recoveredPid };
}

function safariModel(url) {
	const parsed = new URL(url);
	if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/page")
		throw new Error("non-owned Safari URL refused");
	const result = applescript(`tell application "Safari"
set matches to {}
repeat with w in windows
repeat with t in tabs of w
if URL of t is ${quoted(url)} then
if (count tabs of w) is not 1 then error "Unowned Safari tabs"
set end of matches to id of w
end if
end repeat
end repeat
return matches
end tell`);
	return result ? result.split(",").map((id) => Number(id.trim())) : [];
}

function nativeEvidence(binary, owned, path) {
	return JSON.parse(
		execFileSync(binary, [String(owned.pid), owned.bundle, ...(path ? [path] : [])], {
			encoding: "utf8",
			timeout: 10000,
		}),
	);
}

function claimFixture(probe, binaries, bundle, path, url) {
	const snapshot = probe.snapshot();
	const apps = snapshot.apps.filter((app) => app.bundle === bundle);
	if (apps.length !== 1) throw new Error("unique fixture PID required");
	const owned = { pid: apps[0].pid, bundle, ...(path ? { path } : { url }) };
	const ids = path
		? [validateDocumentIdentity(nativeEvidence(binaries.document, owned, path), owned, true)]
		: safariModel(url);
	if (ids.length !== 1 || !Number.isInteger(ids[0]) || ids[0] < 1)
		throw new Error("unique exact fixture model required");
	owned.number = ids[0];
	validateSurfaceOwnership(owned, ids, nativeEvidence(binaries.inventory, owned), snapshot.windows);
	return owned;
}

export function validateSurfaceOwnership(owned, modelIds, inventory, windows) {
	const ax = validateInventory(inventory, owned);
	const surfaces = windows.filter((window) => window.number === owned.number);
	if (
		modelIds.length !== 1 ||
		modelIds[0] !== owned.number ||
		!ax.includes(owned.number) ||
		surfaces.length !== 1 ||
		surfaces[0].pid !== owned.pid ||
		surfaces[0].onScreen !== true
	)
		throw new Error("model/AX/compositor fixture identity mismatch");
	return true;
}

export async function closeOwnedFixture(owned, io) {
	// Both subscriptions and identity revalidation precede the first mutation.
	const surface = await io.subscribe(owned);
	try {
		io.validate(owned);
		io.close(owned);
		await surface.ready;
		const evidence = io.evidence(owned);
		validateOwnedClosure(owned, evidence.document, evidence.inventory, evidence.windows, evidence.modelCount);
		return { ...owned, closed: true, ...evidence };
	} finally {
		surface.cancel();
	}
}

function fixtureIO(probe, binaries) {
	return {
		subscribe: (owned) => subscribeSurface(binaries.surface, owned.pid, owned.number),
		validate(owned) {
			const current = claimFixture(probe, binaries, owned.bundle, owned.path, owned.url);
			if (current.pid !== owned.pid || current.number !== owned.number) throw new Error("fixture ownership changed");
		},
		close(owned) {
			if (owned.path)
				applescript(`tell application "TextEdit"
set matches to every document whose path is ${quoted(owned.path)}
if (count matches) is not 1 then error "Exact document model ambiguous"
close item 1 of matches saving no
end tell`);
			else
				applescript(`tell application "Safari"
set w to first window whose id is ${owned.number}
if (count tabs of w) is not 1 or URL of current tab of w is not ${quoted(owned.url)} then error "Safari ownership changed"
close w
end tell`);
		},
		evidence(owned) {
			const document = owned.path ? nativeEvidence(binaries.document, owned, owned.path) : null;
			let modelCount;
			if (owned.path)
				modelCount = Number(
					applescript(`tell application "TextEdit" to count (every document whose path is ${quoted(owned.path)})`),
				);
			else modelCount = safariModel(owned.url).length;
			return {
				document,
				modelCount,
				inventory: nativeEvidence(binaries.inventory, owned),
				windows: probe.snapshot().windows,
			};
		},
	};
}

export async function cleanupOwnedFixtures(row, probe, binaries, file, control, io = fixtureIO(probe, binaries)) {
	if (row.task !== "clipboard-cross-app" || !Array.isArray(row.owned_fixtures))
		throw new Error("recovery lacks exact fixture ownership; no cleanup performed");
	const allowed = new Set([file, control]);
	const seen = new Set();
	const seenModels = new Set();
	for (const owned of row.owned_fixtures) {
		if (
			!Number.isInteger(owned.pid) ||
			owned.pid < 1 ||
			!Number.isInteger(owned.number) ||
			owned.number < 1 ||
			seen.has(owned.number) ||
			seenModels.has(owned.path ?? owned.url) ||
			(owned.bundle === "com.apple.TextEdit"
				? !allowed.has(owned.path) || owned.url !== undefined
				: owned.bundle !== "com.apple.Safari" || owned.url !== row.url || owned.path !== undefined)
		)
			throw new Error("invalid recovery ownership; no cleanup performed");
		seen.add(owned.number);
		seenModels.add(owned.path ?? owned.url);
	}
	row.closure_evidence = [];
	for (const owned of row.owned_fixtures) {
		// Already-closed fixtures still require all absence oracles; unknown is never absence.
		const evidence = io.evidence(owned);
		try {
			validateOwnedClosure(owned, evidence.document, evidence.inventory, evidence.windows, evidence.modelCount);
		} catch {
			row.closure_evidence.push(await closeOwnedFixture(owned, io));
			continue;
		}
		const surface = await io.subscribe(owned);
		try {
			await surface.ready;
			const after = io.evidence(owned);
			validateOwnedClosure(owned, after.document, after.inventory, after.windows, after.modelCount);
			row.closure_evidence.push({ ...owned, closed: true, ...after });
		} finally {
			surface.cancel();
		}
	}
	for (const path of allowed) {
		if (existsSync(path) && !row.owned_fixtures.some((owned) => owned.path === path))
			throw new Error("fixture file has no recorded exact ownership; retained");
		rmSync(path, { force: true });
	}
}

async function cleanInterruptedFixtures(report, probe, binaries, file, control) {
	const interrupted = report.results.filter(
		(row) => (row.interrupted === true || row.cleanup?.error) && row.fixture_started === true,
	);
	if (!interrupted.length) return;
	for (const row of interrupted) await cleanupOwnedFixtures(row, probe, binaries, file, control);
}

async function setupTextDocument(observer, file, title, contents) {
	writeFileSync(file, contents);
	const opened = await subscribeWindow(observer, title);
	try {
		execFileSync("open", ["-g", "-e", file], { timeout: 10000 });
		await opened.ready;
	} finally {
		opened.cancel();
	}
}

async function main(options, output) {
	for (const task of options.tasks) assertTaskAvailable(task);
	if (process.platform !== "darwin" || isScreenLocked()) throw new Error("locked or unavailable desktop");
	if (lstatSync(ROOT, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("fixture root is a symlink");
	mkdirSync(ROOT, { recursive: true });
	const rootDir = realpathSync(ROOT);
	const outputResolved = resolve(output);
	const lockPath = `${rootDir}/.run.lock`;
	const clipboard = `${root}/scripts/bench-v2/clipboard.swift`;
	const archive = `${rootDir}/apps-agent-clipboard-${process.pid}.plist`;
	let dir;
	let observerBinary;
	let traceBinary;
	let file;
	let control;
	let savedFile;
	let binaries;
	const provenance = fixtureProvenance();
	let report;
	if (existsSync(outputResolved)) {
		report = JSON.parse(readFileSync(outputResolved, "utf8"));
	} else {
		report = {
			schema: "bench-v3-agent-apps",
			seed: options.seed,
			runs: options.runs,
			start_iteration: options.startIteration,
			model: AGENT_MODEL,
			reasoning: AGENT_REASONING,
			timeout_seconds: APP_AGENT_TIMEOUT_SECONDS,
			fixture_policy: SAFARI_FIXTURE_POLICY,
			fixture_provenance: provenance,
			routes: options.routes,
			tasks: options.tasks,
			results: [],
		};
	}
	assertFixturePolicy(report, provenance);
	if (
		report.schema !== "bench-v3-agent-apps" ||
		report.seed !== options.seed ||
		report.runs !== options.runs ||
		(report.start_iteration === undefined ? 1 : report.start_iteration) !== options.startIteration ||
		report.model !== AGENT_MODEL ||
		report.reasoning !== AGENT_REASONING ||
		report.timeout_seconds !== APP_AGENT_TIMEOUT_SECONDS ||
		report.fixture_policy !== SAFARI_FIXTURE_POLICY ||
		JSON.stringify(report.routes) !== JSON.stringify(options.routes) ||
		JSON.stringify(report.tasks) !== JSON.stringify(options.tasks)
	)
		throw new Error("existing report configuration mismatch");
	if (existsSync(outputResolved) && !report.fixture_directory)
		throw new Error("existing report lacks fixture directory provenance; refused before recovery");
	const { lock, recoveredPid } = acquireRunLock(lockPath);
	try {
		dir = prepareFixtureDirectory(rootDir, report, options.tasks).dir;
		observerBinary = `${dir}/window-event-apps-agent`;
		traceBinary = `${dir}/disturbance-apps-agent`;
		file = `${dir}/document.txt`;
		control = `${dir}/other.txt`;
		savedFile = `${dir}/saved-from-sheet.txt`;
		binaries = {
			document: `${dir}/ax-document-identity-apps-agent`,
			inventory: `${dir}/ax-window-inventory-apps-agent`,
			surface: `${dir}/window-surface-event-apps-agent`,
		};
		for (const path of [file, control, savedFile, observerBinary, traceBinary, ...Object.values(binaries)])
			if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink())
				throw new Error(`symlink fixture refused before recovery: ${path}`);
		writeReport(outputResolved, report);
		if (recoveredPid !== null) {
			const interruptedArchive = `${rootDir}/apps-agent-clipboard-${recoveredPid}.plist`;
			if (existsSync(interruptedArchive)) {
				if (report.clipboard_owner_pid !== recoveredPid)
					throw new Error("unproven historical clipboard archive refused; no restore performed");
				execFileSync("swift", [clipboard, "restore", interruptedArchive], { timeout: 60000 });
				rmSync(interruptedArchive, { force: true });
			}
		}
	} catch (error) {
		closeSync(lock);
		rmSync(lockPath, { force: true });
		throw error;
	}
	let probe;
	let initialSnapshot;
	try {
		for (const [name, binary] of Object.entries(binaries)) {
			if (lstatSync(binary, { throwIfNoEntry: false })?.isSymbolicLink())
				throw new Error(`symlink helper refused: ${binary}`);
			const source =
				name === "document"
					? "ax-document-identity"
					: name === "inventory"
						? "ax-window-inventory"
						: "window-surface-event";
			execFileSync("swiftc", [`${root}/scripts/bench-v3/${source}.swift`, "-o", binary], { timeout: 60000 });
		}
		probe = desktopProbe();
		initialSnapshot = probe.snapshot();
		probe.read();
		await cleanInterruptedFixtures(report, probe, binaries, file, control);
		initialSnapshot = probe.snapshot();
		for (const path of [file, control, savedFile, observerBinary, traceBinary])
			if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink())
				throw new Error(`symlink fixture refused: ${path}`);
		if ([file, control, savedFile].some((path) => existsSync(path)))
			throw new Error("pre-existing fixture files refused");
		assertFixtureWindowPreflight(
			initialSnapshot,
			options.tasks.includes("clipboard-cross-app"),
			safariInventory(initialSnapshot, binaries),
			textEditInventory(initialSnapshot, binaries),
		);
	} catch (error) {
		probe?.close();
		closeSync(lock);
		rmSync(lockPath, { force: true });
		throw error;
	}
	const initialWindowNumbers = new Set(initialSnapshot.windows.map((window) => window.number));
	let clipboardSaved = false;
	let pages;
	let stopped = false;
	let activeTrace;
	let activeOracle;
	const abort = new AbortController();
	const halt = () => {
		stopped = true;
		abort.abort();
		activeOracle?.cancel();
	};
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, halt);
	const persist = () => writeReport(outputResolved, report);
	let taskFailed = false;
	let taskError;
	const cleanupErrors = [];
	try {
		execFileSync("swiftc", [`${root}/scripts/bench-v3/window-event.swift`, "-o", observerBinary], {
			timeout: 60000,
		});
		execFileSync("swiftc", [`${root}/scripts/bench-v3/disturbance.swift`, "-o", traceBinary], {
			timeout: 60000,
		});
		report.clipboard_owner_pid = process.pid;
		persist();
		execFileSync("swift", [clipboard, "save", archive], { timeout: 60000 });
		clipboardSaved = true;
		pages = await startPages();
		const schedule = buildAppsAgentSchedule(options);
		for (const slot of pendingAppsAgentSlots(schedule, report.results)) {
			if (stopped) break;
			const url = slot.task === "clipboard-cross-app" ? appsAgentPageUrl(pages.base, slot) : null;
			const row = {
				...slot,
				...(url ? { url } : {}),
				pass: false,
				false_success: false,
				interrupted: true,
				fixture_started: false,
				owned_fixtures: [],
				fixture_failed: true,
				human_help: false,
				help_requested: false,
				calls: null,
				driver_calls: null,
				tokens: null,
				cached_tokens: null,
				cost: null,
				matched_model: null,
				focus_disturbance: null,
				pointer_disturbance: null,
			};
			report.results.push(row);
			persist();
			let before;
			let filesBefore;
			let agentResult;
			const startedAt = performance.now();
			try {
				assertTaskAvailable(slot.task);
				prepareFixtureDirectory(rootDir, report, options.tasks);
				if (isScreenLocked()) throw new Error("screen locked");
				row.fixture_started = true;
				persist();
				filesBefore = snapshotFixtureFiles(rootDir, dir);
				before = probe.read();
				activeTrace = await startDisturbance(traceBinary, {
					onDisturbance: (event) => {
						row.live_disturbance_events ??= [];
						row.live_disturbance_events.push({
							...event,
							phase: row.agent_started_at ? "agent" : "setup",
						});
						stopped = true;
						abort.abort();
					},
				});
				rmSync(savedFile, { force: true });
				writeFileSync(file, "");
				writeFileSync(control, "other document unchanged");
				if (slot.task === "clipboard-cross-app") {
					await setupTextDocument(observerBinary, file, "document.txt", TARGET);
					row.owned_fixtures.push(claimFixture(probe, binaries, "com.apple.TextEdit", file));
					persist();
					abort.signal.throwIfAborted();
					await setupTextDocument(observerBinary, control, "other.txt", "other document unchanged");
					row.owned_fixtures.push(claimFixture(probe, binaries, "com.apple.TextEdit", control));
					persist();
					abort.signal.throwIfAborted();
					const ready = pages.waitFor(url, (state) => Boolean(state?.nonce && state.ready), 10000, abort.signal);
					execFileSync("open", ["-g", "-a", "Safari", url], { timeout: 10000 });
					if (!(await ready)) throw new Error("Safari fixture did not report ready state");
					row.owned_fixtures.push(claimFixture(probe, binaries, "com.apple.Safari", null, url));
					row.baseline_nonce = pages.state(url).nonce;
					persist();
				} else {
					await setupTextDocument(observerBinary, file, "document.txt", "");
					await setupTextDocument(observerBinary, control, "other.txt", "other document unchanged");
				}
				abort.signal.throwIfAborted();
				row.agent_started_at = new Date().toISOString();
				if (slot.task === "clipboard-cross-app") {
					const pageOracleController = new AbortController();
					const pageOutcome = pages.waitFor(
						url,
						(state) => state?.field === TARGET,
						AGENT_TIMEOUT_MS + 10000,
						pageOracleController.signal,
					);
					agentResult = await runAgentRoute({
						route: slot.route,
						signal: abort.signal,
						task: APP_AGENT_GOALS[slot.task](url),
						taskBundles: ["com.apple.TextEdit", "com.apple.Safari"],
					});
					if (pages.state(url)?.field !== TARGET) pageOracleController.abort();
					row.page_outcome_observed = await pageOutcome;
				} else {
					activeOracle = await expectFile(savedFile, TARGET, AGENT_TIMEOUT_MS + 10000);
					agentResult = await runAgentRoute({
						route: slot.route,
						signal: abort.signal,
						task: APP_AGENT_GOALS[slot.task](),
					});
					row.file_event_observed = (await activeOracle.wait(10000)).pass;
				}
				row.agent = agentResult;
				row.result = agentResult.result;
				row.fixture_failed = false;
				row.e2e_seconds = agentResult.elapsedSeconds;
				row.calls = agentResult.toolCalls;
				row.driver_calls = agentResult.driverCalls;
				row.tokens =
					agentResult.inputTokens === null || agentResult.outputTokens === null
						? null
						: agentResult.inputTokens + agentResult.outputTokens;
				row.cached_tokens = agentResult.cachedInputTokens;
				row.cost = agentResult.costUsd;
				row.matched_model = matchedAgentModel(agentResult.model);
				row.help_requested = agentResult.answer.includes("HELP_REQUEST:");
				row.human_help = false;
				const state = url ? pages.state(url) : null;
				const files = {
					source: readFileSync(file, "utf8"),
					control: readFileSync(control, "utf8"),
					source_document: readTextEditDocument(file),
					control_document: readTextEditDocument(control),
					saved: existsSync(savedFile) ? readFileSync(savedFile, "utf8") : null,
				};
				row.oracle = appsAgentOracle(slot.task, state, files);
				row.oracle_inputs = { state, files, baseline_nonce: row.baseline_nonce };
				row.oracle.page_nonce =
					typeof row.baseline_nonce === "string" && state?.nonce === row.baseline_nonce && state.page === url;
				row.oracle.pass &&= row.oracle.page_nonce;
				row.pass = row.oracle.pass;
				row.false_success = appsAgentFalseSuccess(agentResult, row.pass);
				row.actual_file = files.source;
				row.control_file = files.control;
				row.saved_file = files.saved;
				row.duplicate_marker = [files.source, files.source_document, files.saved, state?.field].some(
					hasDuplicateMarker,
				);
				row.unintended_changes = !row.oracle.control_file || !row.oracle.control_document;
			} catch (error) {
				row.error = String(error);
				row.fixture_failed = !agentResult;
				row.false_success = appsAgentFalseSuccess(agentResult, false);
				row.human_help = false;
			} finally {
				activeOracle?.cancel();
				activeOracle = undefined;
				row.e2e_seconds ??= agentResult?.elapsedSeconds ?? (performance.now() - startedAt) / 1000;
				if (before) {
					try {
						const after = probe.read();
						row.focus_disturbance = before.app !== after.app;
						row.pointer_disturbance = Math.hypot(before.x - after.x, before.y - after.y) > 2;
					} catch (error) {
						row.disturbance_error = String(error);
					}
				}
				if (activeTrace) {
					try {
						row.disturbance_trace = await activeTrace.stop();
						row.focus_disturbance ||= row.disturbance_trace.activations.length > 0;
						row.pointer_disturbance ||= row.disturbance_trace.max_cursor_px > 2;
					} catch (error) {
						row.disturbance_error = String(error);
					} finally {
						activeTrace = undefined;
					}
				}
				if (filesBefore) {
					row.unintended_files = changedFixtureFiles(filesBefore, snapshotFixtureFiles(rootDir, dir));
					row.unintended_changes ||= row.unintended_files.length > 0;
				}
				if (appsAgentUnsafe(row)) {
					stopped = true;
					abort.abort();
				}
				try {
					const cleanupBefore = probe.read();
					if (row.fixture_started) {
						prepareFixtureDirectory(rootDir, report, options.tasks);
						await cleanupOwnedFixtures(row, probe, binaries, file, control);
					}
					const cleanupAfter = probe.read();
					row.cleanup_disturbance = {
						focus: cleanupBefore.app !== cleanupAfter.app,
						pointer: Math.hypot(cleanupBefore.x - cleanupAfter.x, cleanupBefore.y - cleanupAfter.y) > 2,
					};
					const closures = refreshCleanupClosures(report.results, row, fixtureIO(probe, binaries).evidence);
					const cleanupSnapshot = probe.snapshot();
					row.auxiliary_surface_evidence = cleanupSnapshot.apps
						.filter((app) => AUXILIARY_BUNDLES.includes(app.bundle))
						.map((app) => {
							try {
								return nativeEvidence(binaries.inventory, app);
							} catch (error) {
								return { ...app, error: String(error) };
							}
						});
					const fixtureWindows = fixtureWindowLeftovers(
						cleanupSnapshot,
						initialWindowNumbers,
						safariInventory(cleanupSnapshot, binaries),
						closures,
						row.auxiliary_surface_evidence,
					);
					row.cleanup_surface_evidence = {
						snapshot: cleanupSnapshot,
						closures,
						leftovers: cleanupSnapshot.windows.filter((window) =>
							fixtureWindows.includes(`${window.owner}:${window.title}`),
						),
					};
					const fileReadback = [file, control, savedFile].map((path) => ({ path, exists: existsSync(path) }));
					const fixtureFiles = fileReadback.filter((item) => item.exists).map((item) => item.path);
					const leftover = [...fixtureWindows, ...fixtureFiles];
					row.cleanup = { attempted: true, leftover, file_readback: fileReadback };
					if (leftover.length) row.cleanup.error = "task-owned fixture leftovers remain";
					if (row.cleanup_disturbance.focus || row.cleanup_disturbance.pointer) {
						row.cleanup.error = "cleanup disturbed the desktop; further fixtures refused";
						stopped = true;
					}
				} catch (error) {
					row.cleanup = { error: String(error) };
					stopped = true;
				}
				row.fixture_and_cleanup_seconds = (performance.now() - startedAt) / 1000;
				row.interrupted = stopped;
				persist();
				process.stdout.write(
					`${slot.route} ${slot.task} ${slot.iteration}/${appsAgentIterationEnd(options.runs, options.startIteration)}: ${row.pass ? "PASS" : "FAIL"}\n`,
				);
			}
			if (row.cleanup?.error) throw new Error("task-owned fixture cleanup failed");
		}
		if (!stopped) report.finished_at = new Date().toISOString();
		persist();
	} catch (error) {
		taskFailed = true;
		taskError = error;
	} finally {
		try {
			halt();
		} catch (error) {
			cleanupErrors.push(`stop run: ${String(error)}`);
		}
		try {
			activeTrace?.cancel();
		} catch (error) {
			cleanupErrors.push(`disturbance trace: ${String(error)}`);
		}
		try {
			activeOracle?.cancel();
		} catch (error) {
			cleanupErrors.push(`file oracle: ${String(error)}`);
		}
		try {
			probe.close();
		} catch (error) {
			cleanupErrors.push(`desktop probe: ${String(error)}`);
		}
		try {
			if (pages) await pages.close();
		} catch (error) {
			cleanupErrors.push(`page server: ${String(error)}`);
		}
		try {
			if (clipboardSaved) {
				execFileSync("swift", [clipboard, "restore", archive], { timeout: 60000 });
				rmSync(archive, { force: true });
			}
		} catch (error) {
			cleanupErrors.push(`clipboard restore: ${String(error)}`);
		} finally {
			try {
				closeSync(lock);
			} catch (error) {
				cleanupErrors.push(`close lock: ${String(error)}`);
			}
			try {
				rmSync(lockPath, { force: true });
			} catch (error) {
				cleanupErrors.push(`remove lock: ${String(error)}`);
			}
			for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.removeListener(signal, halt);
		}
	}
	if (cleanupErrors.length) throw combineCleanupErrors(taskFailed, taskError, cleanupErrors, "run cleanup failed");
	if (taskFailed) throw taskError;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const options = parseAppsAgentOptions(process.argv.slice(2));
	const outputIndex = process.argv.indexOf("--out");
	const output = outputIndex < 0 ? `${root}/.bench/v3/apps-agent-30.json` : process.argv[outputIndex + 1];
	if (!output || output.startsWith("--")) throw new Error("missing --out value");
	await main(options, output);
}

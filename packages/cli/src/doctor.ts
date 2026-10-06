import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StopSwitch } from "@apple-cua/core";
import type { StopStatus } from "@apple-cua/core";

/** The oldest macOS apple-cua supports: ScreenCaptureKit screenshots and the SkyLight input path need it. */
export const MINIMUM_MACOS = "14.0";
export const MINIMUM_NODE_MAJOR = 20;
/** How the signed helper app appears in System Settings, and so the name the user grants permissions to. */
export const HELPER_DISPLAY_NAME = "apple-cua MCP";
const SELF_CHECK_TIMEOUT_MS = 30_000;

export type MachArchitecture = "arm64" | "x86_64";
export type CheckStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
	readonly id: string;
	readonly status: CheckStatus;
	readonly summary: string;
	/** What to do about a warning or a failure. */
	readonly fix?: string;
	/** Only a person can do it (a permission grant); the installation itself is complete. */
	readonly manual?: boolean;
}

export interface DoctorReport {
	/** No check failed: apple-cua is installed and holds its permissions. */
	readonly ready: boolean;
	/** Not ready, but every failure is a manual permission grant: setup itself is done. */
	readonly onlyManualStepsRemain: boolean;
	readonly checks: readonly DoctorCheck[];
	readonly nextSteps: readonly string[];
}

export interface NativeBinaryFacts {
	readonly name: string;
	readonly path: string;
	/** Undefined when the file is missing or is not a Mach-O binary. */
	readonly architectures: readonly MachArchitecture[] | undefined;
}

export interface HelperFacts {
	readonly app: string;
	readonly present: boolean;
	readonly signature: { readonly valid: boolean; readonly detail: string };
	readonly bundledNode: { readonly version: string } | { readonly error: string };
}

/** The part of `server.js --doctor` output the doctor reads. */
export interface SelfCheckReport {
	readonly permissions: { readonly accessibility: boolean; readonly screenRecording: boolean };
	readonly sessionMode: string | undefined;
	readonly processArch: MachArchitecture | undefined;
	readonly processNode: string | undefined;
	readonly nativeCapture: { readonly available: boolean; readonly error: string } | undefined;
}

export type SelfCheckResult =
	| { readonly ok: true; readonly report: SelfCheckReport }
	| { readonly ok: false; readonly error: string };

export interface DoctorFacts {
	readonly macos: { readonly version: string; readonly hardwareArch: MachArchitecture; readonly translated: boolean };
	readonly node: { readonly version: string; readonly execPath: string; readonly arch: MachArchitecture | undefined };
	readonly natives: readonly NativeBinaryFacts[];
	readonly server: { readonly path: string; readonly present: boolean };
	readonly helper: HelperFacts;
	/** Undefined when it could not run because the helper app or server.js is missing. */
	readonly selfCheck: SelfCheckResult | undefined;
	readonly stop: StopStatus;
}

export interface DoctorPaths {
	readonly nativeDir: string;
	readonly helperApp: string;
	readonly server: string;
}

const FAT_MAGIC = 0xcafebabe;
const FAT_MAGIC_64 = 0xcafebabf;
const MH_MAGIC_64 = 0xfeedfacf;
const CPU_TYPE_X86_64 = 0x01000007;
const CPU_TYPE_ARM64 = 0x0100000c;
const MAX_FAT_ARCHITECTURES = 16;

function architectureFor(cpuType: number): MachArchitecture | undefined {
	if (cpuType === CPU_TYPE_ARM64) {
		return "arm64";
	}
	return cpuType === CPU_TYPE_X86_64 ? "x86_64" : undefined;
}

/**
 * The CPU slices a Mach-O file carries, read from its header: every slice of a universal binary, or the one
 * architecture of a thin one. Undefined for anything that is not a 64-bit Mach-O file, so no `lipo` (and no
 * Command Line Tools) is needed to answer.
 */
export function machOArchitectures(header: Buffer): MachArchitecture[] | undefined {
	if (header.length < 8) {
		return undefined;
	}
	const fatMagic = header.readUInt32BE(0);
	if (fatMagic === FAT_MAGIC || fatMagic === FAT_MAGIC_64) {
		const count = header.readUInt32BE(4);
		const entrySize = fatMagic === FAT_MAGIC ? 20 : 32;
		if (count === 0 || count > MAX_FAT_ARCHITECTURES || 8 + count * entrySize > header.length) {
			return undefined;
		}
		const architectures: MachArchitecture[] = [];
		for (let index = 0; index < count; index += 1) {
			const architecture = architectureFor(header.readUInt32BE(8 + index * entrySize));
			if (architecture !== undefined && !architectures.includes(architecture)) {
				architectures.push(architecture);
			}
		}
		return architectures;
	}
	if (header.readUInt32LE(0) === MH_MAGIC_64) {
		const architecture = architectureFor(header.readUInt32LE(4));
		return architecture === undefined ? [] : [architecture];
	}
	return undefined;
}

export function nodeArchitecture(arch: string): MachArchitecture | undefined {
	if (arch === "arm64") {
		return "arm64";
	}
	return arch === "x64" ? "x86_64" : undefined;
}

function versionAtLeast(version: string, minimum: string): boolean {
	const actual = version.split(".").map((part) => Number.parseInt(part, 10));
	const wanted = minimum.split(".").map((part) => Number.parseInt(part, 10));
	for (let index = 0; index < Math.max(actual.length, wanted.length); index += 1) {
		const left = actual[index] ?? 0;
		const right = wanted[index] ?? 0;
		if (Number.isNaN(left) || Number.isNaN(right)) {
			return false;
		}
		if (left !== right) {
			return left > right;
		}
	}
	return true;
}

function nodeMajor(version: string): number {
	return Number.parseInt(version.replace(/^v/, ""), 10);
}

function check(id: string, status: CheckStatus, summary: string, fix?: string, manual?: boolean): DoctorCheck {
	return {
		id,
		status,
		summary,
		...(fix === undefined ? {} : { fix }),
		...(manual === true ? { manual } : {}),
	};
}

function macosCheck(facts: DoctorFacts): DoctorCheck {
	const { version, hardwareArch, translated } = facts.macos;
	const machine = `${hardwareArch === "arm64" ? "Apple Silicon" : "Intel"} (${hardwareArch})`;
	const summary = `macOS ${version} on ${machine}${translated ? ", this process runs under Rosetta" : ""}`;
	return versionAtLeast(version, MINIMUM_MACOS)
		? check("macos", "ok", summary)
		: check(
				"macos",
				"fail",
				`${summary}: apple-cua needs macOS ${MINIMUM_MACOS} (Sonoma) or later`,
				"Update macOS in System Settings > General > Software Update.",
			);
}

function nodeCheck(facts: DoctorFacts): DoctorCheck {
	const summary = `Node ${facts.node.version} (${facts.node.execPath})`;
	return nodeMajor(facts.node.version) >= MINIMUM_NODE_MAJOR
		? check("node", "ok", summary)
		: check(
				"node",
				"fail",
				`${summary} is older than Node ${MINIMUM_NODE_MAJOR}`,
				`Install Node.js ${MINIMUM_NODE_MAJOR} or later, or run ./scripts/setup.sh, which downloads one when none is found.`,
			);
}

function requiredArchitectures(facts: DoctorFacts): MachArchitecture[] {
	const required: MachArchitecture[] = [facts.macos.hardwareArch];
	const candidates = [facts.node.arch, facts.selfCheck?.ok === true ? facts.selfCheck.report.processArch : undefined];
	for (const architecture of candidates) {
		if (architecture !== undefined && !required.includes(architecture)) {
			required.push(architecture);
		}
	}
	return required;
}

function nativeChecks(facts: DoctorFacts): DoctorCheck[] {
	const required = requiredArchitectures(facts);
	return facts.natives.map((binary) => {
		const id = `native:${binary.name}`;
		if (binary.architectures === undefined) {
			return check(
				id,
				"fail",
				`${binary.name} is missing or unreadable (${binary.path})`,
				"Restore it with `git checkout -- packages/core/native`, or rebuild it with ./scripts/setup.sh --rebuild-native.",
			);
		}
		const missing = required.filter((architecture) => !binary.architectures?.includes(architecture));
		const slices = binary.architectures.length === 0 ? "no known slice" : binary.architectures.join(" + ");
		if (missing.length > 0) {
			return check(
				id,
				"fail",
				`${binary.name} has ${slices} but this Mac needs ${missing.join(" + ")}`,
				"Rebuild the universal native binaries: ./scripts/setup.sh --rebuild-native",
			);
		}
		return check(id, "ok", `${binary.name}: ${slices}`);
	});
}

function serverCheck(facts: DoctorFacts): DoctorCheck {
	return facts.server.present
		? check("server", "ok", `MCP server built (${facts.server.path})`)
		: check(
				"server",
				"fail",
				`MCP server not built (${facts.server.path} is missing)`,
				"Run ./scripts/setup.sh to build it.",
			);
}

function helperCheck(facts: DoctorFacts): DoctorCheck {
	const { helper } = facts;
	const rebuild =
		"Rebuild it with ./scripts/setup.sh --rebuild-helper; macOS then asks for Screen Recording and Accessibility again.";
	if (!helper.present) {
		return check(
			"helper",
			"fail",
			`helper app missing (${helper.app})`,
			"Run ./scripts/setup.sh to build the signed helper app.",
		);
	}
	if (!helper.signature.valid) {
		return check("helper", "fail", `helper app signature does not verify: ${helper.signature.detail}`, rebuild);
	}
	if ("error" in helper.bundledNode) {
		return check("helper", "fail", `the helper's bundled node does not run: ${helper.bundledNode.error}`, rebuild);
	}
	if (nodeMajor(helper.bundledNode.version) < MINIMUM_NODE_MAJOR) {
		return check(
			"helper",
			"fail",
			`the helper bundles Node ${helper.bundledNode.version}, older than Node ${MINIMUM_NODE_MAJOR}`,
			rebuild,
		);
	}
	return check(
		"helper",
		"ok",
		`helper app ${helper.app} (signature valid, bundled Node ${helper.bundledNode.version})`,
	);
}

function permissionFix(pane: string, helperApp: string): string {
	return `Grant ${pane} to "${HELPER_DISPLAY_NAME}" in System Settings > Privacy & Security > ${pane}. It is listed there once the server has asked; otherwise add it with + from ${helperApp}. Restart your MCP client afterwards.`;
}

function selfCheckChecks(facts: DoctorFacts): DoctorCheck[] {
	const result = facts.selfCheck;
	if (result === undefined) {
		return [
			check(
				"self-check",
				"fail",
				"permissions not checked: the helper app or server.js is missing",
				"Run ./scripts/setup.sh, then apple-cua doctor again.",
			),
		];
	}
	if (!result.ok) {
		return [
			check(
				"self-check",
				"fail",
				`the server did not answer through the helper: ${result.error}`,
				`Run "${join(facts.helper.app, "Contents/MacOS/apple-cua-mcp")}" "${facts.server.path}" --doctor to see the error; ./scripts/setup.sh --rebuild-helper rebuilds a broken helper.`,
			),
		];
	}
	const { report } = result;
	const helperApp = facts.helper.app;
	const checks: DoctorCheck[] = [
		check(
			"self-check",
			"ok",
			`server.js answered through the helper (Node ${report.processNode ?? "unknown"}, ${report.processArch ?? "unknown arch"})`,
		),
		report.permissions.accessibility
			? check("permission:accessibility", "ok", `Accessibility granted to "${HELPER_DISPLAY_NAME}"`)
			: check(
					"permission:accessibility",
					"fail",
					`Accessibility not granted to "${HELPER_DISPLAY_NAME}" (needed to observe apps and send input)`,
					permissionFix("Accessibility", helperApp),
					true,
				),
		report.permissions.screenRecording
			? check("permission:screen-recording", "ok", `Screen Recording granted to "${HELPER_DISPLAY_NAME}"`)
			: check(
					"permission:screen-recording",
					"fail",
					`Screen Recording not granted to "${HELPER_DISPLAY_NAME}" (needed for screenshots)`,
					`${permissionFix("Screen Recording", helperApp)} On macOS 15 and later the pane is called Screen & System Audio Recording.`,
					true,
				),
	];
	if (report.nativeCapture !== undefined) {
		checks.push(
			report.nativeCapture.available
				? check("native-capture", "ok", "ScreenCaptureKit capture loads in the helper")
				: check(
						"native-capture",
						"warn",
						`ScreenCaptureKit capture unavailable (${report.nativeCapture.error}); screenshots use the CoreGraphics and screencapture fallbacks`,
						"Screenshots still work. If libsckit.dylib is missing or lacks this Mac's architecture, ./scripts/setup.sh --rebuild-native rebuilds it.",
					),
		);
	}
	if (report.sessionMode === "locked") {
		checks.push(check("session", "warn", "the screen is locked; apps report no content until it is unlocked"));
	} else if (report.sessionMode === "remote") {
		checks.push(
			check(
				"session",
				"warn",
				"this session is reached remotely while another user owns the console; some UI may not render",
			),
		);
	}
	return checks;
}

function stopCheck(facts: DoctorFacts): DoctorCheck {
	if (!facts.stop.stopped) {
		return check(
			"stop-switch",
			"ok",
			"stop switch: not stopped (Control+Option+Command or `apple-cua stop` stops every agent)",
		);
	}
	return check(
		"stop-switch",
		"warn",
		`computer use is stopped (${facts.stop.source} at ${facts.stop.stoppedAt}: ${facts.stop.reason}); agents may read but not act`,
		"Run `apple-cua resume` when agents may act again.",
	);
}

/** Turns gathered facts into a verdict. Pure, so every outcome is testable without touching the Mac. */
export function evaluateDoctor(facts: DoctorFacts): DoctorReport {
	const checks: DoctorCheck[] = [
		macosCheck(facts),
		nodeCheck(facts),
		...nativeChecks(facts),
		serverCheck(facts),
		helperCheck(facts),
		...selfCheckChecks(facts),
		stopCheck(facts),
	];
	const failures = checks.filter((item) => item.status === "fail");
	const warnings = checks.filter((item) => item.status === "warn");
	const nextSteps = [...failures, ...warnings].flatMap((item) => (item.fix === undefined ? [] : [item.fix]));
	return {
		ready: failures.length === 0,
		onlyManualStepsRemain: failures.length > 0 && failures.every((item) => item.manual === true),
		checks,
		nextSteps,
	};
}

const STATUS_LABELS: Readonly<Record<CheckStatus, string>> = { ok: "ok  ", warn: "warn", fail: "FAIL" };

export function formatDoctorReport(report: DoctorReport): string {
	const lines = [
		"apple-cua doctor",
		...report.checks.map((item) => `  ${STATUS_LABELS[item.status]}  ${item.summary}`),
	];
	lines.push("");
	if (report.ready) {
		lines.push("Ready: apple-cua is installed and holds its permissions.");
	} else if (report.onlyManualStepsRemain) {
		lines.push(`Installed. One manual step remains, granting permissions to "${HELPER_DISPLAY_NAME}":`);
	} else {
		lines.push("Not ready. Next steps:");
	}
	report.nextSteps.forEach((step, index) => {
		lines.push(`  ${index + 1}. ${step}`);
	});
	return lines.join("\n");
}

export function defaultDoctorPaths(): DoctorPaths {
	const packagesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
	return {
		nativeDir: join(packagesDir, "core/native"),
		helperApp: join(packagesDir, "mcp/dist/apple-cua-mcp.app"),
		server: join(packagesDir, "mcp/dist/server.js"),
	};
}

function readHeader(path: string): Buffer | undefined {
	if (!existsSync(path)) {
		return undefined;
	}
	const descriptor = openSync(path, "r");
	try {
		const header = Buffer.alloc(4096);
		const length = readSync(descriptor, header, 0, header.length, 0);
		return header.subarray(0, length);
	} finally {
		closeSync(descriptor);
	}
}

function commandOutput(file: string, args: readonly string[]): string | undefined {
	try {
		return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return undefined;
	}
}

function processFailure(result: ReturnType<typeof spawnSync>): string {
	if (result.error !== undefined) {
		return result.error.message;
	}
	const stderr = String(result.stderr ?? "").trim();
	const signal = result.signal === null ? "" : ` (signal ${result.signal})`;
	return `exit ${result.status ?? "unknown"}${signal}${stderr === "" ? "" : `: ${stderr.split("\n").slice(-3).join(" | ")}`}`;
}

/** The fields the doctor reads from `server.js --doctor`, validated; undefined for anything else. */
export function parseSelfCheckOutput(stdout: string): SelfCheckReport | undefined {
	const line = stdout
		.trim()
		.split("\n")
		.filter((entry) => entry.trim() !== "")
		.pop();
	if (line === undefined) {
		return undefined;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return undefined;
	}
	if (typeof parsed !== "object" || parsed === null) {
		return undefined;
	}
	const record = parsed as Record<string, unknown>;
	const permissions = record["permissions"] as Record<string, unknown> | undefined;
	if (
		typeof permissions !== "object" ||
		permissions === null ||
		typeof permissions["accessibility"] !== "boolean" ||
		typeof permissions["screenRecording"] !== "boolean"
	) {
		return undefined;
	}
	const session = record["session"] as Record<string, unknown> | undefined;
	const processInfo = record["process"] as Record<string, unknown> | undefined;
	const nativeCapture = record["nativeCapture"] as Record<string, unknown> | undefined;
	return {
		permissions: { accessibility: permissions["accessibility"], screenRecording: permissions["screenRecording"] },
		sessionMode: typeof session?.["mode"] === "string" ? session["mode"] : undefined,
		processArch: typeof processInfo?.["arch"] === "string" ? nodeArchitecture(processInfo["arch"]) : undefined,
		processNode: typeof processInfo?.["node"] === "string" ? processInfo["node"] : undefined,
		nativeCapture:
			typeof nativeCapture?.["available"] === "boolean"
				? {
						available: nativeCapture["available"],
						error: typeof nativeCapture["error"] === "string" ? nativeCapture["error"] : "",
					}
				: undefined,
	};
}

/**
 * Reads the Mac without changing it and without raising a permission prompt. Permissions are read inside the
 * signed helper (server.js --doctor through its launcher), because macOS keys them to the helper's identity, not
 * to the terminal running this command.
 */
export function gatherDoctorFacts(paths: DoctorPaths = defaultDoctorPaths()): DoctorFacts {
	const hardwareArch: MachArchitecture =
		commandOutput("/usr/sbin/sysctl", ["-n", "hw.optional.arm64"]) === "1" ? "arm64" : "x86_64";
	const natives = ["libsckit.dylib", "cursor-overlay"].map((name) => {
		const path = join(paths.nativeDir, name);
		const header = readHeader(path);
		return { name, path, architectures: header === undefined ? undefined : machOArchitectures(header) };
	});

	const launcher = join(paths.helperApp, "Contents/MacOS/apple-cua-mcp");
	const bundledNodePath = join(paths.helperApp, "Contents/Resources/node");
	const present = existsSync(launcher) && existsSync(bundledNodePath);
	let signature = { valid: false, detail: "not checked" };
	let bundledNode: HelperFacts["bundledNode"] = { error: "not checked" };
	if (present) {
		const verify = spawnSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", paths.helperApp], {
			encoding: "utf8",
		});
		signature = { valid: verify.status === 0, detail: verify.status === 0 ? "valid" : processFailure(verify) };
		const version = spawnSync(bundledNodePath, ["--version"], { encoding: "utf8", timeout: SELF_CHECK_TIMEOUT_MS });
		bundledNode = version.status === 0 ? { version: version.stdout.trim() } : { error: processFailure(version) };
	}

	const serverPresent = existsSync(paths.server);
	let selfCheck: SelfCheckResult | undefined;
	if (present && serverPresent) {
		const run = spawnSync(launcher, [paths.server, "--doctor"], {
			encoding: "utf8",
			timeout: SELF_CHECK_TIMEOUT_MS,
		});
		const report = run.status === 0 ? parseSelfCheckOutput(run.stdout) : undefined;
		selfCheck =
			report === undefined
				? {
						ok: false,
						error: run.status === 0 ? "its --doctor output was not a capability report" : processFailure(run),
					}
				: { ok: true, report };
	}

	return {
		macos: {
			version: commandOutput("/usr/bin/sw_vers", ["-productVersion"]) ?? "unknown",
			hardwareArch,
			translated: commandOutput("/usr/sbin/sysctl", ["-n", "sysctl.proc_translated"]) === "1",
		},
		node: { version: process.version, execPath: process.execPath, arch: nodeArchitecture(process.arch) },
		natives,
		server: { path: paths.server, present: serverPresent },
		helper: { app: paths.helperApp, present, signature, bundledNode },
		selfCheck,
		stop: new StopSwitch().status(),
	};
}

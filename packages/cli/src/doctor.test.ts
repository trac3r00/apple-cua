import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type DoctorFacts, evaluateDoctor, machOArchitectures, parseSelfCheckOutput } from "./doctor.js";

const nativeDir = join(dirname(fileURLToPath(import.meta.url)), "../../core/native");

function fatHeader(cpuTypes: readonly number[]): Buffer {
	const header = Buffer.alloc(8 + cpuTypes.length * 20);
	header.writeUInt32BE(0xcafebabe, 0);
	header.writeUInt32BE(cpuTypes.length, 4);
	cpuTypes.forEach((cpuType, index) => {
		header.writeUInt32BE(cpuType, 8 + index * 20);
	});
	return header;
}

function thinHeader(cpuType: number): Buffer {
	const header = Buffer.alloc(32);
	header.writeUInt32LE(0xfeedfacf, 0);
	header.writeUInt32LE(cpuType, 4);
	return header;
}

const ARM64 = 0x0100000c;
const X86_64 = 0x01000007;

function readyFacts(): DoctorFacts {
	return {
		macos: { version: "26.7", hardwareArch: "arm64", translated: false },
		node: { version: "v22.23.2", execPath: "/usr/local/bin/node", arch: "arm64" },
		natives: [
			{ name: "libsckit.dylib", path: "/repo/libsckit.dylib", architectures: ["x86_64", "arm64"] },
			{ name: "cursor-overlay", path: "/repo/cursor-overlay", architectures: ["x86_64", "arm64"] },
		],
		server: { path: "/repo/server.js", present: true },
		helper: {
			app: "/repo/apple-cua-mcp.app",
			present: true,
			signature: { valid: true, detail: "valid" },
			bundledNode: { version: "v22.23.2" },
		},
		selfCheck: {
			ok: true,
			report: {
				permissions: { accessibility: true, screenRecording: true },
				sessionMode: "console",
				processArch: "arm64",
				processNode: "v22.23.2",
				nativeCapture: { available: true, error: "" },
			},
		},
		stop: { stopped: false },
	};
}

function statusOf(facts: DoctorFacts, id: string): string | undefined {
	return evaluateDoctor(facts).checks.find((item) => item.id === id)?.status;
}

describe("#given Mach-O headers #when their architectures are read #then every slice is named without lipo", () => {
	it("names both slices of a universal binary and the one slice of a thin binary", () => {
		expect(machOArchitectures(fatHeader([X86_64, ARM64]))).toEqual(["x86_64", "arm64"]);
		expect(machOArchitectures(thinHeader(ARM64))).toEqual(["arm64"]);
		expect(machOArchitectures(thinHeader(X86_64))).toEqual(["x86_64"]);
	});

	it("answers undefined for a file that is not a Mach-O binary", () => {
		expect(machOArchitectures(Buffer.from("#!/usr/bin/env bash\necho hi\n"))).toBeUndefined();
		expect(machOArchitectures(Buffer.alloc(4))).toBeUndefined();
	});

	it("finds both an Apple Silicon and an Intel slice in the committed native binaries", () => {
		for (const name of ["libsckit.dylib", "cursor-overlay"]) {
			const architectures = machOArchitectures(readFileSync(join(nativeDir, name)).subarray(0, 4096));
			expect(architectures).toEqual(expect.arrayContaining(["arm64", "x86_64"]));
		}
	});
});

describe("#given a fully installed and permitted Mac #when the doctor evaluates it #then it is ready", () => {
	it("passes every check and has no next step", () => {
		const report = evaluateDoctor(readyFacts());

		expect(report.ready).toBe(true);
		expect(report.onlyManualStepsRemain).toBe(false);
		expect(report.nextSteps).toEqual([]);
		expect(report.checks.every((item) => item.status === "ok")).toBe(true);
	});
});

describe("#given a fresh helper identity without grants #when the doctor evaluates it #then the grants are the one manual step left", () => {
	it("fails only the two manual permission checks, each with a fix", () => {
		const facts = readyFacts();
		const report = evaluateDoctor({
			...facts,
			selfCheck: {
				ok: true,
				report: {
					permissions: { accessibility: false, screenRecording: false },
					sessionMode: "console",
					processArch: "arm64",
					processNode: "v24.11.0",
					nativeCapture: { available: true, error: "" },
				},
			},
		});

		const failures = report.checks.filter((item) => item.status === "fail");
		expect(report.ready).toBe(false);
		expect(report.onlyManualStepsRemain).toBe(true);
		expect(failures.map((item) => item.id)).toEqual(["permission:accessibility", "permission:screen-recording"]);
		expect(failures.every((item) => item.manual === true && item.fix !== undefined)).toBe(true);
		expect(report.nextSteps).toHaveLength(2);
	});
});

describe("#given an Intel Mac and thin Apple Silicon binaries #when the doctor evaluates it #then the missing slice is a failure to rebuild", () => {
	it("fails the native check and does not call it a manual step", () => {
		const facts = readyFacts();
		const report = evaluateDoctor({
			...facts,
			macos: { ...facts.macos, hardwareArch: "x86_64" },
			node: { ...facts.node, arch: "x86_64" },
			natives: facts.natives.map((binary) => ({ ...binary, architectures: ["arm64"] as const })),
		});

		expect(report.checks.find((item) => item.id === "native:libsckit.dylib")).toMatchObject({
			status: "fail",
			fix: expect.stringContaining("--rebuild-native"),
		});
		expect(report.ready).toBe(false);
		expect(report.onlyManualStepsRemain).toBe(false);
	});
});

describe("#given broken or missing pieces #when the doctor evaluates them #then each one fails its own check", () => {
	it("fails the helper and skips permissions when the helper app is missing", () => {
		const facts = readyFacts();
		const report = evaluateDoctor({
			...facts,
			helper: { ...facts.helper, present: false, bundledNode: { error: "not checked" } },
			selfCheck: undefined,
		});

		expect(statusOf({ ...facts, helper: { ...facts.helper, present: false }, selfCheck: undefined }, "helper")).toBe(
			"fail",
		);
		expect(report.checks.find((item) => item.id === "self-check")?.status).toBe("fail");
		expect(report.checks.some((item) => item.id.startsWith("permission:"))).toBe(false);
		expect(report.onlyManualStepsRemain).toBe(false);
	});

	it("fails a macOS older than the floor and a Node older than 20", () => {
		const facts = readyFacts();

		expect(statusOf({ ...facts, macos: { ...facts.macos, version: "13.6.9" } }, "macos")).toBe("fail");
		expect(statusOf({ ...facts, macos: { ...facts.macos, version: "14.0" } }, "macos")).toBe("ok");
		expect(statusOf({ ...facts, node: { ...facts.node, version: "v18.20.4" } }, "node")).toBe("fail");
	});

	it("fails when the server does not answer through the helper", () => {
		const facts = readyFacts();

		expect(statusOf({ ...facts, selfCheck: { ok: false, error: "exit 1" } }, "self-check")).toBe("fail");
	});
});

describe("#given conditions that leave the install working #when the doctor evaluates them #then they warn without blocking readiness", () => {
	it("warns about a pressed stop switch and a missing native capture, and stays ready", () => {
		const facts = readyFacts();
		const report = evaluateDoctor({
			...facts,
			stop: { stopped: true, stoppedAt: "2026-10-06T00:00:00.000Z", reason: "stopped by user", source: "cli" },
			selfCheck: {
				ok: true,
				report: {
					permissions: { accessibility: true, screenRecording: true },
					sessionMode: "console",
					processArch: "arm64",
					processNode: "v22.23.2",
					nativeCapture: { available: false, error: "libsckit.dylib not found" },
				},
			},
		});

		expect(report.ready).toBe(true);
		expect(report.checks.find((item) => item.id === "stop-switch")?.status).toBe("warn");
		expect(report.checks.find((item) => item.id === "native-capture")?.status).toBe("warn");
		expect(report.nextSteps).toHaveLength(2);
	});
});

describe("#given server.js --doctor output #when it is parsed #then only a capability report is accepted", () => {
	it("reads permissions, process and native capture from the last JSON line", () => {
		const line = JSON.stringify({
			permissions: { accessibility: false, screenRecording: true },
			session: { mode: "console" },
			process: { node: "v24.11.0", arch: "x64" },
			nativeCapture: { available: true, error: "" },
		});

		expect(parseSelfCheckOutput(`warning: something\n${line}\n`)).toEqual({
			permissions: { accessibility: false, screenRecording: true },
			sessionMode: "console",
			processArch: "x86_64",
			processNode: "v24.11.0",
			nativeCapture: { available: true, error: "" },
		});
	});

	it("rejects output that is not JSON or lacks the permission booleans", () => {
		expect(parseSelfCheckOutput("Fatal error: boom")).toBeUndefined();
		expect(parseSelfCheckOutput(JSON.stringify({ permissions: { accessibility: "yes" } }))).toBeUndefined();
		expect(parseSelfCheckOutput("")).toBeUndefined();
	});
});

#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { captureWindowPng } from "../packages/core/dist/platform/macos-ffi/screenshot.js";
import { openWindowsForTargeting } from "../packages/core/dist/platform/macos-open-windows.js";

const execFileAsync = promisify(execFile);
const MAX_WIDTH = 1200;
const MAX_HEIGHT = 900;
const WARM_RUNS = 10;
const scriptPath = fileURLToPath(import.meta.url);

function pngDimensions(data) {
	if (!data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
		throw new Error("capture did not return PNG magic bytes");
	}
	return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function imageSummary(data) {
	if (data.length <= 1024) {
		throw new Error(`capture returned only ${data.length} bytes (expected >1KB)`);
	}
	return { bytes: data.length, format: "png", ...pngDimensions(data) };
}

async function captureCli(windowId) {
	const directory = await mkdtemp(join(tmpdir(), "macos-cua-window-measure-"));
	const capturedPath = join(directory, "captured.png");
	const resizedPath = join(directory, "resized.png");
	try {
		await execFileAsync("screencapture", ["-x", "-o", "-l", String(windowId), "-t", "png", capturedPath]);
		await execFileAsync("sips", ["-z", String(MAX_HEIGHT), String(MAX_WIDTH), capturedPath, "--out", resizedPath], {
			maxBuffer: 10 * 1024 * 1024,
		});
		return await readFile(resizedPath);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

async function timed(capture) {
	const started = performance.now();
	const data = await capture();
	return { milliseconds: performance.now() - started, data };
}

function median(values) {
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

async function childResult(mode, windowId) {
	return await new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [scriptPath, mode, String(windowId)], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8").on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.setEncoding("utf8").on("data", (chunk) => {
			stderr += chunk;
		});
		child.once("error", reject);
		child.once("exit", (code) => {
			if (code !== 0) {
				reject(new Error(`cold ${mode} child exited ${code}: ${stderr || stdout}`));
				return;
			}
			try {
				resolve(JSON.parse(stdout));
			} catch (error) {
				reject(new Error(`cold ${mode} child returned invalid JSON: ${stdout}`, { cause: error }));
			}
		});
	});
}

function intersectionArea(left, right) {
	const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
	const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
	return width * height;
}

function selectWindow(windows) {
	const usable = windows.filter(
		(window) => window.id > 0 && window.title && window.bounds.width >= 320 && window.bounds.height >= 240,
	);
	for (let targetIndex = 1; targetIndex < usable.length; targetIndex += 1) {
		const target = usable[targetIndex];
		const targetArea = target.bounds.width * target.bounds.height;
		const covering = usable
			.slice(0, targetIndex)
			.find((candidate) => intersectionArea(candidate.bounds, target.bounds) >= targetArea * 0.25);
		if (covering) {
			return { target, covering };
		}
	}
	if (usable.length === 0) {
		throw new Error("openWindowsForTargeting returned no substantial titled on-screen window");
	}
	return { target: usable[0], covering: undefined };
}

async function normalizedBgra(data) {
	const directory = await mkdtemp(join(tmpdir(), "macos-cua-window-compare-"));
	const input = join(directory, "input.png");
	const output = join(directory, "output.bmp");
	try {
		await writeFile(input, data);
		await execFileAsync("sips", ["-s", "format", "bmp", "-z", "64", "64", input, "--out", output], {
			maxBuffer: 10 * 1024 * 1024,
		});
		const bmp = await readFile(output);
		const pixelOffset = bmp.readUInt32LE(10);
		const bitsPerPixel = bmp.readUInt16LE(28);
		if (bitsPerPixel !== 32) {
			throw new Error(`expected normalized BMP to be 32bpp, got ${bitsPerPixel}`);
		}
		return bmp.subarray(pixelOffset, pixelOffset + 64 * 64 * 4);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

async function visualDifference(left, right) {
	const [leftPixels, rightPixels] = await Promise.all([normalizedBgra(left), normalizedBgra(right)]);
	let total = 0;
	for (let index = 0; index < leftPixels.length; index += 4) {
		total += Math.abs(leftPixels[index] - rightPixels[index]);
		total += Math.abs(leftPixels[index + 1] - rightPixels[index + 1]);
		total += Math.abs(leftPixels[index + 2] - rightPixels[index + 2]);
	}
	return total / (64 * 64 * 3);
}

async function runChildMode(mode, windowId) {
	const measurement =
		mode === "--cold-native"
			? await timed(() => Promise.resolve(captureWindowPng(windowId, MAX_WIDTH, MAX_HEIGHT).data))
			: await timed(() => captureCli(windowId));
	process.stdout.write(JSON.stringify({ milliseconds: measurement.milliseconds, ...imageSummary(measurement.data) }));
}

function printLine(line) {
	process.stdout.write(`${line}\n`);
}

async function main() {
	const windows = await openWindowsForTargeting();
	const { target, covering } = selectWindow(windows);
	const windowLabel = `${target.owner?.name ?? "unknown"}: ${target.title}`;
	printLine(`Window: ${windowLabel} (CGWindowID ${target.id}, ${target.bounds.width}x${target.bounds.height} points)`);
	if (covering) {
		printLine(
			`Occlusion candidate: ${covering.owner?.name ?? "unknown"}: ${covering.title} (in front with >=25% bounds overlap)`,
		);
	} else {
		printLine("Occlusion candidate: none found from WindowServer ordering");
	}

	const coldNative = await childResult("--cold-native", target.id);
	const coldCli = await childResult("--cold-cli", target.id);

	captureWindowPng(target.id, MAX_WIDTH, MAX_HEIGHT);
	const nativeRuns = [];
	let nativeData;
	for (let run = 0; run < WARM_RUNS; run += 1) {
		const measurement = await timed(() => Promise.resolve(captureWindowPng(target.id, MAX_WIDTH, MAX_HEIGHT).data));
		nativeRuns.push(measurement.milliseconds);
		nativeData = measurement.data;
	}

	await captureCli(target.id);
	const cliRuns = [];
	let cliData;
	for (let run = 0; run < WARM_RUNS; run += 1) {
		const measurement = await timed(() => captureCli(target.id));
		cliRuns.push(measurement.milliseconds);
		cliData = measurement.data;
	}

	const nativeSummary = imageSummary(nativeData);
	const cliSummary = imageSummary(cliData);
	const difference = await visualDifference(nativeData, cliData);
	const occludedOwnContent = covering ? difference < 20 : null;

	printLine(
		`Cold native: ${coldNative.milliseconds.toFixed(2)} ms (${coldNative.width}x${coldNative.height}, ${coldNative.bytes} bytes, ${coldNative.format})`,
	);
	printLine(
		`Cold CLI:    ${coldCli.milliseconds.toFixed(2)} ms (${coldCli.width}x${coldCli.height}, ${coldCli.bytes} bytes, ${coldCli.format})`,
	);
	printLine(
		`Warm native median (${WARM_RUNS}): ${median(nativeRuns).toFixed(2)} ms [${nativeRuns.map((value) => value.toFixed(2)).join(", ")}]`,
	);
	printLine(
		`Warm CLI median    (${WARM_RUNS}): ${median(cliRuns).toFixed(2)} ms [${cliRuns.map((value) => value.toFixed(2)).join(", ")}]`,
	);
	printLine(
		`Native output: ${nativeSummary.width}x${nativeSummary.height}, ${nativeSummary.bytes} bytes, ${nativeSummary.format} magic OK (>1KB)`,
	);
	printLine(
		`CLI output:    ${cliSummary.width}x${cliSummary.height}, ${cliSummary.bytes} bytes, ${cliSummary.format} magic OK (>1KB)`,
	);
	printLine(
		occludedOwnContent === null
			? "Occluded-window check: NOT RUN (no overlapping front window found)"
			: `Occluded-window check: ${occludedOwnContent ? "PASS" : "FAIL"} (native-vs-CLI normalized RGB MAE ${difference.toFixed(2)}; threshold <20)`,
	);
}

const mode = process.argv[2];
if (mode === "--cold-native" || mode === "--cold-cli") {
	const windowId = Number(process.argv[3]);
	await runChildMode(mode, windowId);
} else {
	await main();
}

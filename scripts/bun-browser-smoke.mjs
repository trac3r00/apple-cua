#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { resolve } from "node:path";

if (!("bun" in process.versions)) {
	process.stderr.write("Run this smoke with Bun: bun scripts/bun-browser-smoke.mjs\n");
	process.exit(1);
}

const root = resolve(import.meta.dir, "..");

async function doctor(label, entry) {
	const child = Bun.spawn(["bun", entry, "doctor"], { cwd: root, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code !== 0) {
		process.stderr.write(`${label} failed with exit ${code}\n${stderr || stdout}\n`);
		process.exit(1);
	}
	let parsed;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		process.stderr.write(`${label} did not print JSON:\n${stdout}\n`);
		process.exit(1);
	}
	if (typeof parsed.installed !== "boolean" || typeof parsed.running !== "boolean") {
		process.stderr.write(`${label} printed an unexpected shape: ${stdout}\n`);
		process.exit(1);
	}
	process.stdout.write(`${label}: installed=${parsed.installed} running=${parsed.running}\n`);
}

await doctor("browser source doctor", "packages/browser/src/cli.ts");

const builtCli = resolve(root, "packages/browser/dist/cli.js");
if (existsSync(builtCli)) await doctor("browser dist doctor", "packages/browser/dist/cli.js");
else process.stdout.write("browser dist doctor: skipped (run pnpm --filter @apple-cua/browser build)\n");

process.stdout.write("bun browser smoke: pass\n");

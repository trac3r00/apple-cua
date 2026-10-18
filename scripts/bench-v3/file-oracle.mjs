import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

/** Kernel directory subscription is acknowledged before the caller triggers an atomic save. */
export async function expectState(path, predicate, timeoutMs = 10000) {
	const child = spawn("swift", [fileURLToPath(new URL("./file-event.swift", import.meta.url)), path], {
		stdio: ["pipe", "pipe", "pipe"],
	});
	const lines = createInterface({ input: child.stdout });
	let signal;
	let readyResolve;
	let readyReject;
	let closed = false;
	let timer = null;
	const ready = new Promise((resolve, reject) => {
		readyResolve = resolve;
		readyReject = reject;
	});
	const result = new Promise((resolve) => {
		signal = resolve;
	});
	const close = (value) => {
		if (closed) return;
		closed = true;
		clearTimeout(timer);
		child.stdin.end();
		signal(value);
	};
	const verify = () => {
		try {
			if (predicate()) close({ pass: true });
		} catch (error) {
			if (error.code !== "ENOENT") close({ pass: false, error: String(error) });
		}
	};
	lines.on("line", (line) => {
		if (line === "READY") readyResolve();
		if (line === "CHANGED") verify();
	});
	const failed = (error) => {
		readyReject(error);
		close({ pass: false, error: String(error) });
	};
	child.once("error", failed);
	child.once("close", (code) => {
		if (!closed) failed(new Error(`file watcher exited ${code}`));
	});
	const startup = setTimeout(() => {
		failed(new Error("file watcher readiness timeout"));
		child.kill();
	}, 10000);
	try {
		await ready;
	} finally {
		clearTimeout(startup);
	}
	timer = setTimeout(() => {
		verify();
		close({ pass: false, timeout: true });
	}, timeoutMs);
	verify();
	return {
		result,
		verify,
		wait(deadlineMs = 10000) {
			if (!closed) {
				clearTimeout(timer);
				timer = setTimeout(() => {
					verify();
					close({ pass: false, timeout: true });
				}, deadlineMs);
				verify();
			}
			return result;
		},
		cancel: () => close({ pass: false, cancelled: true }),
	};
}

export function expectFile(path, expected, timeoutMs = 10000) {
	return expectState(path, () => readFileSync(path, "utf8") === expected, timeoutMs);
}

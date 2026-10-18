import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export async function startDisturbance(binary, { onDisturbance, spawnProcess = spawn } = {}) {
	const child = spawnProcess(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
	const lines = createInterface({ input: child.stdout });
	let readyResolve;
	let summaryResolve;
	let failure;
	const ready = new Promise((resolve, reject) => {
		readyResolve = resolve;
		failure = reject;
	});
	const summary = new Promise((resolve, reject) => {
		summaryResolve = resolve;
		const prior = failure;
		failure = (error) => {
			prior(error);
			reject(error);
		};
	});
	summary.catch(() => undefined);
	lines.on("line", (line) => {
		try {
			const result = JSON.parse(line);
			if (result.ready) readyResolve();
			if (result.disturbance) onDisturbance?.(result.disturbance);
			if (result.summary) summaryResolve(result.summary);
		} catch (error) {
			failure(error);
			child.kill();
		}
	});
	child.once("error", failure);
	child.once("close", (code) => {
		if (code !== 0) failure(new Error(`trace exited ${code}`));
	});
	const timer = setTimeout(() => {
		failure(new Error("trace readiness timeout"));
		child.kill();
	}, 10000);
	try {
		await ready;
	} finally {
		clearTimeout(timer);
	}
	return {
		async stop() {
			const timer = setTimeout(() => {
				failure(new Error("trace stop timeout"));
				child.kill();
			}, 10000);
			child.stdin.end("stop\n");
			try {
				return await summary;
			} finally {
				clearTimeout(timer);
			}
		},
		cancel: () => child.kill(),
	};
}

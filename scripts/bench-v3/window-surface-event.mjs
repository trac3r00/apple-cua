import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export async function subscribeSurface(binary, pid, number, spawnObserver = spawn) {
	if (![pid, number].every((value) => Number.isInteger(value) && value > 0))
		throw new Error("invalid owned surface identity");
	const child = spawnObserver(binary, [String(pid), String(number)], { stdio: ["ignore", "pipe", "pipe"] });
	let resolveSubscribed;
	let resolveReady;
	let rejectSubscribed;
	let rejectReady;
	const subscribed = new Promise((resolve, reject) => {
		resolveSubscribed = resolve;
		rejectSubscribed = reject;
	});
	const ready = new Promise((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	ready.catch(() => undefined);
	let armed = false;
	let completed = false;
	const fail = (error) => {
		rejectSubscribed(error);
		rejectReady(error);
	};
	const timer = setTimeout(() => child.kill("SIGKILL"), 12000);
	const lines = createInterface({ input: child.stdout });
	lines.on("line", (line) => {
		if (line === "SUBSCRIBED") {
			armed = true;
			resolveSubscribed();
		}
		if (line === "READY" && armed) {
			completed = true;
			resolveReady();
		}
	});
	child.once("error", fail);
	child.once("close", (code) => {
		clearTimeout(timer);
		if (code !== 0 || !armed || !completed) fail(new Error(`surface observer incomplete, exit ${code}`));
	});
	await subscribed;
	return { ready, cancel: () => child.kill("SIGTERM") };
}

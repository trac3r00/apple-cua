import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export async function subscribeWindow(binary, title, closing = false, bundle = "com.apple.TextEdit") {
	const child = spawn(binary, [title, closing ? "closed" : "open", bundle], { stdio: ["ignore", "pipe", "pipe"] });
	const lines = createInterface({ input: child.stdout });
	let subscribedResolve;
	let readyResolve;
	let rejectBoth;
	const subscribed = new Promise((resolve, reject) => {
		subscribedResolve = resolve;
		rejectBoth = reject;
	});
	const ready = new Promise((resolve, reject) => {
		readyResolve = resolve;
		const previous = rejectBoth;
		rejectBoth = (error) => {
			previous(error);
			reject(error);
		};
	});
	// A failure before setup must not produce an unhandled rejection.
	ready.catch(() => undefined);
	const timer = setTimeout(() => child.kill("SIGKILL"), 12000);
	lines.on("line", (line) => {
		if (line === "SUBSCRIBED") subscribedResolve();
		if (line === "READY") readyResolve();
	});
	child.once("error", rejectBoth);
	child.once("close", (code) => {
		clearTimeout(timer);
		if (code !== 0) rejectBoth(new Error(`window observer exited ${code}`));
	});
	await subscribed;
	return { ready, cancel: () => child.kill() };
}

import { execFileSync } from "node:child_process";
import { desktopProbe } from "../bench-v2/desktop.mjs";

const probe = desktopProbe();
try {
	const snapshot = probe.snapshot();
	const app = snapshot.apps.find((item) => item.bundle === "com.apple.Safari");
	let model = null;
	let ax = null;
	if (app) {
		model = execFileSync(
			"osascript",
			[
				"-e",
				'tell application "Safari"\nset rows to {}\nrepeat with w in windows\nset end of rows to {id of w, visible of w, count tabs of w}\nend repeat\nreturn rows\nend tell',
			],
			{ encoding: "utf8", timeout: 10000 },
		).trim();
		ax = execFileSync("/tmp/cua-bench/ax-window-inventory-v3", [String(app.pid), "com.apple.Safari"], {
			encoding: "utf8",
			timeout: 10000,
		}).trim();
	}
	process.stdout.write(
		`${JSON.stringify({ app, windows: snapshot.windows.filter((item) => item.owner === "Safari"), model, ax })}\n`,
	);
} finally {
	probe.close();
}

import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";
import { PAGE_HEADING, ROOT } from "./fixture.mjs";

const bundle = {
	TextEdit: "com.apple.TextEdit",
	Finder: "com.apple.finder",
	Safari: "com.apple.Safari",
	Calculator: "com.apple.calculator",
	"System Settings": "com.apple.systempreferences",
};
const fixtureTitle = (title) =>
	[
		"document.txt",
		"other.txt",
		"rich.rtf",
		"saved-from-sheet.txt",
		"renamed.txt",
		"cua-bench",
		"start",
		"bench-folder",
		PAGE_HEADING,
	].some((name) => title === name || title.includes(`${name} —`) || title.endsWith(` — ${name}`)) ||
	title.startsWith(ROOT);

export function cleanupPlan(baseline, current, spec, beforeRun = baseline) {
	const initialApp =
		{
			safari: "Safari",
			finder: "Finder",
			calculator: "Calculator",
			settings: "System Settings",
		}[spec.fixture] ?? "TextEdit";
	const apps = new Set([initialApp]);
	for (const step of spec.steps) apps.add(step.app);
	if (spec.fixture === "cross-app") apps.add("Safari");
	if (spec.id === "two-apps-one-task") apps.add("Finder");
	const running = new Set(beforeRun.apps.map((app) => app.bundle));
	const existing = new Set(baseline.windows.map((window) => window.number));
	const quit = current.apps.filter(
		(app) => [...apps].some((name) => bundle[name] === app.bundle) && !running.has(app.bundle),
	);
	const newWindows = current.windows.filter(
		(window) =>
			!existing.has(window.number) &&
			!quit.some((app) => app.pid === window.pid) &&
			current.apps.some((app) => app.pid === window.pid && [...apps].some((name) => bundle[name] === app.bundle)),
	);
	const windows = newWindows.filter(
		(window) =>
			current.apps.some((app) => app.pid === window.pid && app.bundle !== bundle.Safari) &&
			(fixtureTitle(window.title) || (spec.id === "textedit-save-sheet" && window.title === "Untitled")),
	);
	return { quit, windows, newWindows };
}

const osa = (script) =>
	execFileSync("osascript", ["-e", script], { encoding: "utf8", timeout: 5000, killSignal: "SIGKILL" });

// An app stuck quitting (TextEdit behind an unsaved-changes prompt) drops out of the running-app
// list while its process lives on without windows, and the next fixture's `open` then hands its
// document to that half-quit process. So exit means the process is gone, not the list entry.
function processAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function awaitAppExit(_probe, pid, durationMs) {
	const deadline = performance.now() + durationMs;
	while (processAlive(pid)) {
		if (performance.now() >= deadline) return false;
		await new Promise((resolve) => setTimeout(resolve, Math.min(100, deadline - performance.now())));
	}
	return true;
}

export async function cleanupAttempt(probe, baseline, spec, pageUrl, beforeRun = baseline) {
	const result = { closed: [], quit: [], forced: [], leftover: [] };
	let current;
	try {
		current = probe.snapshot();
	} catch (error) {
		result.leftover.push(`Cannot inventory windows: ${String(error)}`);
		return result;
	}
	const plan = cleanupPlan(baseline, current, spec, beforeRun);
	for (const app of plan.quit) {
		try {
			const name = Object.keys(bundle).find((key) => bundle[key] === app.bundle);
			const started = performance.now();
			let quitError = null;
			try {
				osa(
					name === "TextEdit"
						? 'tell application "TextEdit" to quit saving no'
						: `tell application "${name}" to quit`,
				);
			} catch (error) {
				quitError = String(error);
			}
			if (!(await awaitAppExit(probe, app.pid, Math.max(0, 5000 - (performance.now() - started))))) {
				// This app was absent at run start and identified by bundle when cleanup was planned, seconds
				// ago; a half-quit process has already left the app list, so check the process itself.
				if (processAlive(app.pid)) {
					process.kill(app.pid, "SIGTERM");
					result.forced.push(`${app.bundle}: SIGTERM${quitError ? ` after ${quitError}` : ""}`);
				}
				if (!(await awaitAppExit(probe, app.pid, 2000)) && processAlive(app.pid)) {
					process.kill(app.pid, "SIGKILL");
					result.forced.push(`${app.bundle}: SIGKILL`);
				}
			}
			if (await awaitAppExit(probe, app.pid, 2000)) result.quit.push(app.bundle);
			else result.leftover.push(`${app.bundle}: app still running after bounded quit and termination`);
		} catch (error) {
			result.leftover.push(`${app.bundle}: ${String(error)}`);
		}
	}
	for (const window of plan.windows) {
		const app = current.apps.find((item) => item.pid === window.pid);
		const name = Object.keys(bundle).find((key) => bundle[key] === app?.bundle);
		const label = `${name} window ${window.number} (${window.title})`;
		const remains = () =>
			probe
				.snapshot()
				.windows.some(
					(item) => item.number === window.number && item.pid === window.pid && item.onScreen !== false,
				);
		try {
			const title = window.title.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
			// AppleScript closes by title, which is only safe when no other window of the app shares it
			// (a pre-existing window of the user's could); a shared title goes straight to the
			// window-number route.
			const uniqueTitle =
				current.windows.filter((item) => item.pid === window.pid && item.title === window.title).length === 1;
			try {
				// Finder's scripting id for a window is its window number, so it closes exactly that window.
				if (name === "Finder") osa(`tell application "Finder" to close window id ${window.number}`);
				else if (!uniqueTitle) throw new Error("shared title");
				else
					osa(
						name === "TextEdit"
							? `tell application "TextEdit" to close window "${title}" saving no`
							: `tell application "${name}" to close window "${title}"`,
					);
			} catch {
				/* Off-console, window scripting fails; the window-targeted Cmd+W below still works. */
			}
			// Windows close asynchronously, so give each route a bounded moment before judging it.
			const closedWithin = async (ms) => {
				const deadline = performance.now() + ms;
				while (remains()) {
					if (performance.now() >= deadline) return false;
					await new Promise((resolve) => setTimeout(resolve, 100));
				}
				return true;
			};
			if (!(await closedWithin(uniqueTitle || name === "Finder" ? 3000 : 0))) {
				try {
					await probe.closeWindowByNumber(app.bundle, window.pid, window.number);
				} catch (error) {
					// The window may have finished closing between the check and the key press.
					if (remains()) throw error;
				}
				if (!(await closedWithin(3000))) throw new Error("window still present after window-targeted Cmd+W");
			}
			result.closed.push(label);
		} catch (error) {
			result.leftover.push(`${label}: ${String(error)}`);
		}
	}
	// An attempt can leave Finder behind a modal alert ("change the extension?"). Off-console nobody
	// sees it, and Finder then answers every script with "busy" (-15260), failing later oracles. Dismiss
	// it with Return (an OK-only alert) and then Escape (a cancelable one), and report it if it stays.
	const finder = current.apps.find((item) => item.bundle === bundle.Finder);
	if (finder && (spec.fixture === "finder" || spec.steps.some((step) => step.app === "Finder"))) {
		const busy = () => {
			try {
				osa('tell application "Finder" to get name of startup disk');
				return false;
			} catch (error) {
				// "busy" (-15260) behind an alert, or no answer at all (-1712, or our own 5 s timeout).
				return /-15260|-1712|ETIMEDOUT/.test(String(error));
			}
		};
		for (const key of ["Return", "Escape"]) {
			if (!busy()) break;
			try {
				// The alert is an untitled window of Finder's own; aim the key at it, not at a folder window.
				const alert = probe
					.snapshot()
					.windows.find((item) => item.pid === finder.pid && item.onScreen !== false && item.title === "");
				await probe.pressKey(bundle.Finder, finder.pid, key, alert?.number);
				result.closed.push(`Finder modal (${key})`);
			} catch (error) {
				result.leftover.push(`Finder modal: ${String(error)}`);
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
		if (busy()) {
			// Off-console the alert ignores background keys, like the Save panel; relaunching the benchmark
			// user's Finder is the only way back, and it is reported as a forced cleanup.
			execFileSync("killall", ["-u", userInfo().username, "Finder"]);
			const deadline = performance.now() + 10000;
			while (performance.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 500));
				try {
					osa('tell application "Finder" to get name of startup disk');
					break;
				} catch {
					/* Finder is still starting. */
				}
			}
			if (busy()) result.leftover.push("Finder still busy after Return, Escape and a relaunch");
			else result.forced.push("com.apple.finder: relaunched to clear a modal alert that ignored keys");
		}
	}
	let safariRunning = false;
	if (spec.fixture === "safari" || spec.fixture === "cross-app") {
		try {
			safariRunning = probe.snapshot().apps.some((app) => app.bundle === bundle.Safari);
		} catch (error) {
			result.leftover.push(`Cannot inventory Safari tabs: ${String(error)}`);
		}
	}
	if (safariRunning) {
		// Tabs can live inside a pre-existing Safari window; never close that entire window.
		try {
			const script = `tell application "Safari"\nrepeat with w in windows\nrepeat with t in tabs of w\nif URL of t starts with "${pageUrl}" then close t\nend repeat\nend repeat\nend tell`;
			osa(script);
			const tabs = osa('tell application "Safari" to get URL of every tab of every window');
			if (tabs.includes(pageUrl)) throw new Error("fixture tab still open");
			// Off-console, Safari answers no tab URLs at all; the window list still names the fixture page
			// in the front tab's window title, so any Safari window still showing it is a leftover.
			const showsFixture = () =>
				probe
					.snapshot()
					.windows.some(
						(window) =>
							current.apps.some((app) => app.pid === window.pid && app.bundle === bundle.Safari) &&
							window.title.includes(PAGE_HEADING),
					);
			// Safari takes a moment to tear a window down after Cmd+W, so wait a bounded time for it.
			const deadline = performance.now() + 3000;
			while (!tabs.trim() && showsFixture() && performance.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 200));
			}
			if (!tabs.trim() && showsFixture()) throw new Error("a Safari window still shows the fixture page");
			result.closed.push(`Safari tab ${pageUrl}`);
		} catch (error) {
			result.leftover.push(`Safari tab ${pageUrl}: ${String(error)}`);
		}
	}
	try {
		const remaining = probe.snapshot();
		for (const window of plan.newWindows) {
			if (
				remaining.windows.some(
					(item) => item.pid === window.pid && item.number === window.number && item.onScreen !== false,
				) &&
				!result.leftover.some((text) => text.includes(`window ${window.number} (`))
			)
				result.leftover.push(
					`fixture candidate window ${window.pid}:${window.number} (${window.title}) still open`,
				);
		}
	} catch (error) {
		result.leftover.push(`Cannot verify remaining windows: ${String(error)}`);
	}
	return result;
}

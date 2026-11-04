import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
	type HistorySegmentSummary,
	deleteHistorySegments,
	historyPaths,
	listHistorySegments,
	parseHistoryDuration,
	readHistoryState,
	writeHistoryState,
} from "@opencua/core/light";
import { resolveStateDir } from "@opencua/core/stop";
import type { Command } from "commander";
import { z } from "zod/v4";
import { historyServiceStatus, installHistoryService, uninstallHistoryService } from "./history-service.js";

type HistoryCommandOptions = {
	readonly isJsonOutput: () => boolean;
};

export function registerHistoryCommands(program: Command, options: HistoryCommandOptions): void {
	const history = program.command("history").description("Control the always-on cua-history watcher");

	history
		.command("list")
		.description("List recorded 10-minute history segments, newest first, with the apps each one holds")
		.option("--limit <count>", "Most segments to show", "36")
		.action((command: { readonly limit: string }) => {
			const limit = Number.parseInt(command.limit, 10);
			if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
				throw new Error("--limit must be an integer from 1 to 1000.");
			}
			const segments = listHistorySegments(historyPaths(resolveStateDir()));
			const shown = segments.slice(0, limit);
			if (options.isJsonOutput()) {
				process.stdout.write(`${JSON.stringify({ total: segments.length, segments: shown })}\n`);
				return;
			}
			if (segments.length === 0) {
				process.stdout.write("No history recorded yet.\n");
				return;
			}
			process.stdout.write(`${shown.map(formatSegment).join("\n")}\n`);
			if (shown.length < segments.length) {
				process.stdout.write(
					`${segments.length - shown.length} older segment(s) not shown; pass --limit to see them.\n`,
				);
			}
		});

	history
		.command("delete")
		.description("Delete recorded history: exact segment ids, the last period (--last 1h), or all of it (--all)")
		.argument("[segment-ids...]", "segment ids from opencua history list")
		.option("--last <duration>", "delete every segment overlapping the last 15m, 2h, 1d, ...")
		.option("--all", "delete every recorded segment")
		.option("--yes", "confirm the deletion")
		.action(
			async (
				ids: readonly string[],
				command: { readonly last?: string; readonly all?: boolean; readonly yes?: boolean },
			) => {
				const selectors = [ids.length > 0, command.last !== undefined, command.all === true].filter(Boolean).length;
				if (selectors !== 1) {
					throw new Error("Name what to delete with exactly one of: segment ids, --last <duration>, or --all.");
				}
				const deletion =
					ids.length > 0
						? { ids }
						: command.last !== undefined
							? { withinMs: parseHistoryDuration(command.last) }
							: { all: true as const };
				if (command.yes !== true) {
					throw new Error("Deleting history cannot be undone; add --yes to confirm.");
				}
				const paths = historyPaths(resolveStateDir());
				const deleted = deleteHistorySegments(paths, deletion);
				// Suggestions are derived from the segments, so rebuild them: deleted activity must not stay in the menu.
				const { suggestHistorySkills } = await import("@opencua/core");
				const { writeMenuSuggestions } = await import("./history-suggest.js");
				await mkdir(paths.root, { recursive: true, mode: 0o700 });
				await writeMenuSuggestions(paths.root, await suggestHistorySkills(paths.root, { limit: 5 }));
				if (options.isJsonOutput()) {
					process.stdout.write(`${JSON.stringify({ deleted })}\n`);
					return;
				}
				process.stdout.write(
					deleted.length === 0
						? "Nothing to delete.\n"
						: `Deleted ${deleted.length} segment(s): ${deleted.join(", ")}. Skill suggestions were rebuilt without them; recording continues.\n`,
				);
			},
		);

	history
		.command("suggest")
		.description("List repeated workflows detected locally in recent history as skill suggestions (no model call)")
		.option("--limit <count>", "Maximum suggestions", "5")
		.option("--write", "Also write skill-suggestions.json for the menu bar")
		.action(async (command: { readonly limit: string; readonly write?: boolean }) => {
			const limit = Number.parseInt(command.limit, 10);
			if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
				throw new Error("--limit must be an integer from 1 to 20.");
			}
			const { suggestHistorySkills } = await import("@opencua/core");
			const { formatSuggestions, menuSuggestions, writeMenuSuggestions } = await import("./history-suggest.js");
			const paths = historyPaths(resolveStateDir());
			const detection = await suggestHistorySkills(paths.root, { limit });
			if (command.write === true) {
				await mkdir(paths.root, { recursive: true, mode: 0o700 });
				await writeMenuSuggestions(paths.root, detection);
			}
			process.stdout.write(
				options.isJsonOutput()
					? `${JSON.stringify({ ...detection, suggestions: menuSuggestions(detection) })}\n`
					: formatSuggestions(detection),
			);
		});

	const record = history.command("record").description("Mark a deliberate skill demonstration in history");
	record
		.command("start")
		.description("Start marking a demonstration; perform the workflow, then run `opencua history record stop`")
		.action(async () => {
			const { startHistoryDemonstration } = await import("./history-demonstration.js");
			const paths = historyPaths(resolveStateDir());
			const demonstration = await startHistoryDemonstration(paths.root);
			await writeFile(join(paths.root, "active-demonstration.json"), JSON.stringify({ id: demonstration.id }), {
				mode: 0o600,
			});
			process.stdout.write(
				options.isJsonOutput()
					? `${JSON.stringify(demonstration)}\n`
					: `Demonstration ${demonstration.id} started. Do the workflow, then run: opencua history record stop\n`,
			);
		});
	record
		.command("stop")
		.description("Stop the active demonstration and print the prompt to give your agent")
		.option("--id <uuid>", "Demonstration id (defaults to the active one)")
		.action(async (command: { readonly id?: string }) => {
			const { stopHistoryDemonstration } = await import("./history-demonstration.js");
			const paths = historyPaths(resolveStateDir());
			const activePath = join(paths.root, "active-demonstration.json");
			const id =
				command.id ??
				(await readFile(activePath, "utf8").then(
					(text) => z.object({ id: z.uuid() }).parse(JSON.parse(text)).id,
					() => undefined,
				));
			if (id === undefined) throw new Error("No active demonstration. Start one with: opencua history record start");
			const stopped = await stopHistoryDemonstration(paths.root, id);
			await rm(activePath, { force: true });
			const prompt = `Create a reusable skill from my OpenCUA history demonstration ${stopped.id} (${stopped.startedAt} to ${stopped.endedAt ?? ""}). Read the matching events from cua_history_status paths, draft a SKILL.md with parameters instead of private values, show me the draft, and save it with cua_history_save_skill after I approve.`;
			process.stdout.write(
				options.isJsonOutput()
					? `${JSON.stringify({ ...stopped, prompt })}\n`
					: `Demonstration stopped.\n\n${prompt}\n`,
			);
		});

	history
		.command("open")
		.description("Show skill suggestions in the terminal; --web opens the legacy local timeline page")
		.option("--web", "Open the legacy localhost timeline page instead")
		.option("--no-open", "With --web: print the local URL without opening a browser")
		.option("--record", "With --web: focus the recording controls")
		.option("--skills-dir <path>", "Directory for reviewed skills", join(homedir(), ".agents", "skills"))
		.action(
			async (command: {
				readonly open: boolean;
				readonly skillsDir: string;
				readonly record?: boolean;
				readonly web?: boolean;
			}) => {
				if (command.web !== true) {
					const { suggestHistorySkills } = await import("@opencua/core");
					const { formatSuggestions } = await import("./history-suggest.js");
					const detection = await suggestHistorySkills(historyPaths(resolveStateDir()).root, { limit: 5 });
					process.stdout.write(formatSuggestions(detection));
					return;
				}
				const { startHistoryUi } = await import("./history-ui.js");
				const ui = await startHistoryUi({
					stateDirectory: resolveStateDir(),
					skillsDirectory: command.skillsDir,
				});
				const stop = () => {
					void ui.close();
				};
				process.once("SIGINT", stop);
				process.once("SIGTERM", stop);
				const url = command.record === true ? `${ui.url}?record=1` : ui.url;
				if (!command.open) {
					process.stdout.write(`${url}\n`);
					return;
				}
				try {
					await promisify(execFile)("/usr/bin/open", [url]);
					process.stdout.write(
						"History opened. Close it from the page when finished; recording is independent.\n",
					);
				} catch (error: unknown) {
					await ui.close();
					throw error;
				}
			},
		);

	history
		.command("digest")
		.description("Summarize one completed segment only when automatic summaries are enabled")
		.action(async () => {
			const { digestLatestHistory } = await import("./history-digest.js");
			const paths = historyPaths(resolveStateDir());
			try {
				const result = await digestLatestHistory(paths.root);
				await mkdir(paths.root, { recursive: true, mode: 0o700 });
				await writeFile(
					join(paths.root, "automation-status.json"),
					JSON.stringify({ state: result.state, updatedAt: new Date().toISOString() }),
					{ mode: 0o600 },
				);
				process.stdout.write(`${JSON.stringify({ state: result.state })}\n`);
			} catch {
				await mkdir(paths.root, { recursive: true, mode: 0o700 });
				await writeFile(
					join(paths.root, "automation-status.json"),
					JSON.stringify({ state: "error", updatedAt: new Date().toISOString() }),
					{ mode: 0o600 },
				);
				throw new Error("Automatic history summary failed. Check model access and preview the segment in history.");
			}
		});

	history
		.command("start")
		.description("Install and start the cua-history watcher (menu-bar status item, autostart at login)")
		.action(async () => {
			const paths = await installHistoryService();
			if (options.isJsonOutput()) {
				process.stdout.write(`${JSON.stringify({ started: true, launchAgent: paths.launchAgent })}\n`);
				return;
			}
			process.stdout.write(
				`cua-history watcher started and set to launch at login.\nData: ${paths.stateDirectory}/cua-history\nIt records which apps and windows you use, clicks and shortcuts in every app, private browser windows included. Typed text is off by default and password fields are never recorded. To skip an app, open the opencua menu bar item and choose Don't record.\nNext: run opencua permissions grant. It walks you through Input Monitoring (keystrokes and clicks) and Accessibility (window titles) for "opencua-mcp", the same entry the rest of opencua uses.\n`,
			);
		});

	history
		.command("stop")
		.description("Stop the cua-history watcher and remove it from login items")
		.action(async () => {
			const paths = await uninstallHistoryService();
			if (options.isJsonOutput()) {
				process.stdout.write(`${JSON.stringify({ stopped: true, launchAgent: paths.launchAgent })}\n`);
				return;
			}
			process.stdout.write("cua-history watcher stopped.\n");
		});

	history
		.command("pause")
		.description("Pause recording without stopping the watcher (its current segment is kept)")
		.action(() => {
			const paths = historyPaths(resolveStateDir());
			if (readHistoryState(paths) === "running") {
				writeHistoryState(paths, "paused");
			}
			if (options.isJsonOutput()) {
				process.stdout.write(`${JSON.stringify({ state: readHistoryState(paths) })}\n`);
				return;
			}
			process.stdout.write(`cua-history ${readHistoryState(paths)}.\n`);
		});

	history
		.command("resume")
		.description("Resume a paused watcher")
		.action(() => {
			const paths = historyPaths(resolveStateDir());
			if (readHistoryState(paths) === "paused") {
				writeHistoryState(paths, "running");
			}
			if (options.isJsonOutput()) {
				process.stdout.write(`${JSON.stringify({ state: readHistoryState(paths) })}\n`);
				return;
			}
			process.stdout.write(`cua-history ${readHistoryState(paths)}.\n`);
		});

	history
		.command("status")
		.description("Report whether the cua-history watcher is installed and running")
		.action(async () => {
			const status = await historyServiceStatus();
			if (options.isJsonOutput()) {
				process.stdout.write(`${JSON.stringify(status)}\n`);
				return;
			}
			process.stdout.write(
				`installed: ${status.installed}\nrunning: ${status.running}\nstate: ${status.state}${status.reason === undefined ? "" : ` (${status.reason})`}\ndata: ${status.eventStreamRootPath}\n`,
			);
		});
}

function formatSegment(segment: HistorySegmentSummary): string {
	const time = (iso: string): string =>
		new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
	const day = new Date(segment.startedAt).toLocaleDateString();
	const apps = segment.apps.length === 0 ? "no app events" : segment.apps.join(", ");
	return `${segment.id}  ${day} ${time(segment.startedAt)}-${time(segment.endedAt)}  ${segment.eventCount} event(s)  ${apps}`;
}

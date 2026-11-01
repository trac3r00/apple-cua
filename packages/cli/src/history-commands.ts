import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { historyPaths, readHistoryState, writeHistoryState } from "@apple-cua/core";
import { resolveStateDir } from "@apple-cua/core/stop";
import type { Command } from "commander";
import { historyServiceStatus, installHistoryService, uninstallHistoryService } from "./history-service.js";

type HistoryCommandOptions = {
	readonly isJsonOutput: () => boolean;
};

export function registerHistoryCommands(program: Command, options: HistoryCommandOptions): void {
	const history = program.command("history").description("Control the always-on cua-history watcher");

	history
		.command("open")
		.description("Open the local history timeline to review activity and create reusable skills")
		.option("--no-open", "Print the local URL without opening a browser")
		.option("--record", "Focus the deliberate workflow recording controls")
		.option("--skills-dir <path>", "Directory for reviewed skills", join(homedir(), ".agents", "skills"))
		.action(async (command: { readonly open: boolean; readonly skillsDir: string; readonly record?: boolean }) => {
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
				process.stdout.write("History opened. Close it from the page when finished; recording is independent.\n");
			} catch (error: unknown) {
				await ui.close();
				throw error;
			}
		});

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
				`cua-history watcher started and set to launch at login.\nData: ${paths.stateDirectory}/cua-history\nNext: run apple-cua permissions grant. It walks you through Input Monitoring (keystrokes and clicks) and Accessibility (window titles) for "apple-cua-mcp", the same entry the rest of apple-cua uses.\n`,
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
				`installed: ${status.installed}\nrunning: ${status.running}\nstate: ${status.state}\ndata: ${status.eventStreamRootPath}\n`,
			);
		});
}

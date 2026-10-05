import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT, TARGET } from "./fixture.mjs";

/**
 * Agent-level profiles: the same omo agent, model and prompt, with a different computer-use hand.
 * The scripted drivers in drivers.mjs measure the driver; these measure what an agent achieves with it.
 */
const repo = path.resolve(new URL("../..", import.meta.url).pathname);
// Plain node, as the scripted apple driver runs it: the signed helper app lacks Screen Recording on
// this Mac and raises a permission prompt mid-task, which would measure TCC setup, not the hand.
const appleServer = {
	command: "node",
	args: [path.join(repo, "packages/mcp/dist/server.js")],
	env: {
		APPLE_CUA_ALLOWED_BUNDLE_IDS:
			"com.apple.finder,com.apple.TextEdit,com.apple.Safari,com.apple.systempreferences,com.apple.calculator",
		APPLE_CUA_DELIVERY: "background",
	},
};
const off = { command: "true", enabled: false };
const RULES =
	"Rules: act only on the app windows and files the task names. Do not create, edit, rename or delete files with shell commands; the change must be made through the app. Do not quit apps or close windows unless the task says so. Never ask the user anything: if you cannot finish, say so plainly. When done, reply with one short line stating the result.";
export const PROFILES = {
	"omo-native": {
		servers: { "apple-cua": off, "llm-pool-systemone": off },
		hand: "You have no computer-use MCP server. Drive the apps with your built-in tools (for example osascript, System Events, screencapture).",
		mcpPrefix: null,
	},
	"omo-cua": {
		servers: {
			"apple-cua": off,
			"llm-pool-systemone": off,
			"cua-driver": { command: path.join(os.homedir(), ".local/bin/cua-driver"), args: ["mcp"] },
		},
		hand: "Use the cua-driver MCP tools (find them with tool_search) for every app interaction. Do not drive apps with osascript or other shell commands.",
		mcpPrefix: "cua-driver",
	},
	"omo-apple": {
		servers: { "apple-cua": appleServer, "llm-pool-systemone": off },
		hand: "Use the apple-cua MCP tools (find them with tool_search) for every app interaction. Do not drive apps with osascript or other shell commands.",
		mcpPrefix: "apple-cua",
	},
	"omo-apple-jev": {
		servers: { "apple-cua": appleServer },
		hand: "Use the apple-cua MCP tools (find them with tool_search) for every app interaction. Do not drive apps with osascript or other shell commands. Use Jev (the llm-pool-systemone systemone_evaluate tool) as your decision kernel: before each UI action, send it the goal plus a compact candidate list from apple-cua (find_elements, or get_app_state with element_format=table) and act on the option it chooses.",
		mcpPrefix: "apple-cua",
	},
};

/** One natural-language goal per scenario; the fixture has already opened the app, as for the scripted drivers. */
const GOALS = {
	"calculator-add": () =>
		"Use the Calculator app to compute 2 + 3, then copy the result from Calculator to the clipboard.",
	"clipboard-copy": () =>
		"TextEdit has document.txt open. Copy the document's entire text to the clipboard from TextEdit.",
	"clipboard-cross-app": (url) =>
		`Copy the entire text of the TextEdit document document.txt and paste it into the field labeled "Code" on the page ${url} that is open in Safari. Do not submit the page.`,
	"finder-create-folder": () =>
		`In the Finder window showing ${ROOT}, create a new folder named bench-folder in that folder.`,
	"finder-navigate": () => `Make the Finder window that is showing the folder "start" navigate to ${ROOT}.`,
	"finder-rename-file": () => `In the Finder window showing ${ROOT}, rename document.txt to renamed.txt.`,
	"finder-select-file": () =>
		`In the Finder window showing ${ROOT}, select the file document.txt and leave it selected.`,
	"safari-form": (url) =>
		`In Safari, open ${url} and type "${TARGET}" into the field labeled "Code". Do not submit the page.`,
	"safari-heading": (url) => `In Safari, open ${url} and tell me the page's main heading.`,
	"safari-link": (url) => `In Safari, open ${url} and click the link "Destination".`,
	"settings-version": () =>
		"In System Settings, open General > About so the About pane showing the macOS version is on screen, and tell me the version.",
	"stale-token-recovery": () =>
		`In TextEdit, replace the whole contents of document.txt with exactly "${TARGET}" and save it.`,
	"textedit-alert-dismiss": () =>
		`In TextEdit, replace all of document.txt's text with "${TARGET}". Then start closing its window, and when TextEdit asks about the unsaved changes, cancel, so the document stays open with the new text and nothing is saved.`,
	"textedit-fill-save": () =>
		`In TextEdit, replace the whole contents of document.txt with exactly "${TARGET}" and save it.`,
	"textedit-multiline": () =>
		'In TextEdit, replace the whole contents of document.txt with two lines, "first line" and then "second line", and save it.',
	"textedit-rich-bold": () =>
		`In TextEdit, replace the whole contents of rich.rtf with "${TARGET}", make all of that text bold, and save it.`,
	"textedit-save-sheet": () =>
		`In TextEdit, create a new plain-text document containing exactly "${TARGET}" and save it as ${ROOT}/saved-from-sheet.txt using TextEdit's Save dialog.`,
	"textedit-select-replace": () =>
		`In TextEdit, replace the whole contents of document.txt with exactly "${TARGET}" and save it.`,
	"textedit-two-windows": () =>
		`TextEdit has document.txt and other.txt open. Replace the whole contents of document.txt with exactly "${TARGET}" and save it. Leave other.txt unchanged.`,
	"textedit-undo": () =>
		'In TextEdit, replace all of document.txt\'s text with "temporary", then undo that change so the original text is back, and save the document.',
	"two-apps-one-task": () =>
		`In TextEdit, replace the whole contents of document.txt with exactly "${TARGET}" and save it. Then make the Finder window showing the folder "start" navigate to ${ROOT}.`,
};

const TIMEOUT_MS = Number(process.env.BENCH_AGENT_TIMEOUT_MS ?? 420000);

export class OmoAgentDriver {
	constructor(kind, options) {
		const profile = PROFILES[kind];
		if (!profile) throw new Error(`unknown agent profile: ${kind}`);
		this.kind = kind;
		this.profile = profile;
		this.model = options.model;
		this.thinking = options.thinking;
		// Outside /tmp/cua-bench, so an agent listing its working directory sees no fixture files.
		this.cwd = path.join("/tmp/omo-bench-profiles", kind);
		for (const dir of [".pi", ".omo"]) {
			mkdirSync(path.join(this.cwd, dir), { recursive: true });
			writeFileSync(path.join(this.cwd, dir, "mcp.json"), JSON.stringify({ mcpServers: profile.servers }, null, 2));
		}
		this.calls = 0;
		this.call_ms = [];
		this.seconds = 0;
		this.text_bytes = 0;
		this.image_base64_bytes = 0;
		this.estimated_tokens = 0;
		this.image_tokens = 0;
		this.claimed = false;
		this.human_ask = false;
		this.gave_up = false;
		this.keyboard_fallbacks = 0;
		this.trace = [];
		this.agent = {
			model: null,
			turns: 0,
			tools: {},
			cu_calls: 0,
			shell_calls: 0,
			decision_calls: 0,
			nested_calls: 0,
			input_tokens: 0,
			output_tokens: 0,
			cache_read_tokens: 0,
			cost_usd: 0,
			answer: "",
			timed_out: false,
			exit_code: null,
		};
	}

	prompt(spec, pageUrl) {
		const goal = GOALS[spec.id];
		if (!goal) throw new Error(`no agent goal for scenario ${spec.id}`);
		return `${goal(pageUrl)}\n\n${this.profile.hand}\n\n${RULES}`;
	}

	/** Runs the whole task as one omo -p session and accounts for every tool call and token it spent. */
	runTask(spec, pageUrl) {
		const args = [
			"-p",
			"--mode",
			"json",
			"--no-session",
			"--approve",
			"--model",
			this.model,
			"--thinking",
			this.thinking,
			this.prompt(spec, pageUrl),
		];
		const started = performance.now();
		const pending = new Map();
		return new Promise((resolve, reject) => {
			const child = spawn("omo", args, { cwd: this.cwd, stdio: ["ignore", "pipe", "pipe"], detached: true });
			let buffer = "";
			const timer = setTimeout(() => {
				this.agent.timed_out = true;
				try {
					process.kill(-child.pid, "SIGTERM");
				} catch {}
			}, TIMEOUT_MS);
			child.stdout.on("data", (chunk) => {
				buffer += chunk;
				let newline = buffer.indexOf("\n");
				while (newline >= 0) {
					this.consume(buffer.slice(0, newline), pending);
					buffer = buffer.slice(newline + 1);
					newline = buffer.indexOf("\n");
				}
			});
			child.stderr.on("data", () => {});
			child.on("error", (error) => {
				clearTimeout(timer);
				reject(error);
			});
			child.on("close", (code) => {
				clearTimeout(timer);
				this.consume(buffer, pending);
				this.agent.exit_code = code;
				this.seconds = (performance.now() - started) / 1000;
				this.estimated_tokens = this.agent.input_tokens + this.agent.output_tokens + this.agent.cache_read_tokens;
				const answer = this.agent.answer;
				this.claimed =
					/\b(done|saved|completed|success|selected|renamed|created|copied|pasted|clicked|navigated|typed)\b/i.test(
						answer,
					);
				this.gave_up =
					this.agent.timed_out ||
					/\b(unable|cannot|can't|could not|couldn't|not able|blocked|failed)\b/i.test(answer);
				this.human_ask = /\b(please|would you|can you|could you)\b.*\?/i.test(answer);
				if (this.agent.timed_out) return reject(new Error(`timeout: agent exceeded ${TIMEOUT_MS} ms`));
				if (code !== 0) return reject(new Error(`driver-error: omo exited ${code}`));
				resolve({ answer });
			});
		});
	}

	consume(line, pending) {
		if (!line.startsWith("{")) return;
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			return;
		}
		if (event.type === "tool_execution_start") {
			const name = String(event.toolName ?? "unknown");
			// Tools called from inside an eval cell are reported too; they are hand calls, not model turns.
			const nested = [...pending.values()].some((call) => call.name === "eval");
			pending.set(event.toolCallId, { name, start: performance.now() });
			if (nested) this.agent.nested_calls++;
			else this.calls++;
			this.agent.tools[name] = (this.agent.tools[name] ?? 0) + 1;
			const prefix = this.profile.mcpPrefix;
			if (prefix && name.includes(prefix)) this.agent.cu_calls++;
			if (/systemone/.test(name)) this.agent.decision_calls++;
			if (/^(bash|eval)$/.test(name)) this.agent.shell_calls++;
			if (process.env.BENCH_TRACE === "1")
				this.trace.push({ name, args: JSON.stringify(event.args ?? event.input ?? {}).slice(0, 300) });
		} else if (event.type === "tool_execution_end") {
			const call = pending.get(event.toolCallId);
			if (call !== undefined) this.call_ms.push(performance.now() - call.start);
			pending.delete(event.toolCallId);
		} else if (event.type === "message_end" && event.message?.role === "assistant") {
			const message = event.message;
			this.agent.turns++;
			this.agent.model = `${message.provider ?? ""}/${message.model ?? ""}`;
			const usage = message.usage ?? {};
			this.agent.input_tokens += usage.input ?? 0;
			this.agent.output_tokens += usage.output ?? 0;
			this.agent.cache_read_tokens += usage.cacheRead ?? 0;
			this.agent.cost_usd += usage.cost?.total ?? 0;
			const text = (message.content ?? [])
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("\n")
				.trim();
			if (text) this.agent.answer = text.slice(0, 2000);
		}
	}
}

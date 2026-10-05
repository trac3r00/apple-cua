import { accountPayload } from "./metrics.mjs";

const text = (result) =>
	(result?.content ?? [])
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
const parsed = (result) => {
	const block = (result?.content ?? []).find((b) => b.type === "text" && b.text.trim().startsWith("{"));
	return block === undefined ? {} : JSON.parse(block.text);
};

export class Driver {
	constructor(kind, client) {
		this.kind = kind;
		// "apple" drives apple-cua the way its instructions recommend (compact table observations, no
		// screenshot, described-element clicks); "apple-legacy" keeps the pre-2026-09-23 call pattern
		// (screenshot + menu bar + JSON tree, observe before every click) as the before baseline.
		this.apple = kind === "apple" || kind === "apple-legacy";
		this.efficient = kind === "apple";
		this.client = client;
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
		this.last = "";
		this.tokens = new Map();
		/** Apps whose observation said window content is unreachable (a session off the console). */
		this.remoteApps = new Set();
		this.windows = new Map();
	}
	async call(name, args, allowAmbiguity = false) {
		const start = performance.now();
		this.calls++;
		let result;
		try {
			result = await this.client.callTool(name, args);
		} finally {
			const elapsed = performance.now() - start;
			this.call_ms.push(elapsed);
			this.seconds += elapsed / 1000;
		}
		const payload = accountPayload(result);
		this.text_bytes += payload.text_bytes;
		this.image_base64_bytes += payload.image_base64_bytes;
		this.estimated_tokens += payload.estimated_tokens;
		this.image_tokens += payload.image_tokens;
		const answer = text(result);
		this.last = answer;
		if (process.env.BENCH_TRACE === "1")
			this.trace.push({
				name,
				args,
				error: result?.isError === true,
				answer: answer.slice(0, Number(process.env.BENCH_TRACE_CHARS ?? 600)),
			});
		this.claimed ||=
			!["get_app_state", "get_window_state", "list_windows"].includes(name) &&
			/\b(verified|success|completed)\b/i.test(answer) &&
			!/not verified|unverifiable/i.test(answer) &&
			!result?.isError;
		this.human_ask ||= /ask the user|needs_user|elicitation/i.test(answer);
		this.gave_up ||= /\b(refus(ed|al)|timed? out|timeout)\b/i.test(answer);
		if (result?.isError && !(allowAmbiguity && answer.includes("same_pid_keyboard_ambiguity")))
			throw new Error(`tool-error: ${answer.slice(0, 300)}`);
		return result;
	}
	async window(app, title) {
		const result = await this.call("list_windows", {});
		const candidates = (result.structuredContent?.windows ?? []).filter((w) => w.app_name === app && w.is_on_screen);
		const window = title ? candidates.find((w) => w.title === title) : candidates[0];
		if (!window) throw new Error(`target-missing: ${app} ${title ?? ""}`);
		this.windows.set(app, window);
		return window;
	}
	async observe(app, title) {
		if (this.apple) {
			const args = this.efficient
				? { app, include_screenshot: false, element_format: "table" }
				: { app, include_screenshot: true, include_menu_bar: true };
			let result = await this.call("get_app_state", args);
			let state = parsed(result);
			// With several windows the focused one may not be the asked-for one; apple-cua lists them
			// all in windowCandidates, so pick the titled window by id, as an agent would.
			const candidate = (state.windowCandidates ?? []).find((window) => window.title === title);
			if (title && state.windowTitle !== title && candidate !== undefined) {
				result = await this.call("get_app_state", { ...args, window_id: candidate.id });
				state = parsed(result);
			}
			if (title && state.windowTitle !== title)
				throw new Error(`target-missing: expected ${title}, observed ${state.windowTitle}`);
			this.tokens.set(app, state.observation_token);
			if (state.windowContentUnavailable === true) this.remoteApps.add(app);
			return result;
		}
		const window = await this.window(app, title);
		return this.call("get_window_state", { pid: window.pid, window_id: window.window_id, include_screenshot: true });
	}
	async act(step, appleArgs, cuaArgs) {
		const { app, title } = step;
		const name = {
			type: ["type_text", "type_text"],
			key: ["press_keys", "press_key"],
			"click-label": ["click", "click"],
			menu: ["invoke_menu", "invoke_menu"],
		}[step.op];
		if (this.apple) {
			if (!this.tokens.get(app)) await this.observe(app, title);
			let result;
			try {
				result = await this.call(name[0], { app, observation_token: this.tokens.get(app), ...appleArgs });
			} catch (error) {
				// apple-cua refuses input when the observed window changed since the observation (a sheet
				// opened or closed) and asks for a fresh one; an agent re-observes and retries once.
				if (!/"needsExplicitObservation":\s*true/.test(String(error))) throw error;
				await this.observe(app, title);
				result = await this.call(name[0], { app, observation_token: this.tokens.get(app), ...appleArgs });
			}
			this.tokens.set(app, parsed(result).observation_token);
			return result;
		}
		const window = this.windows.get(app) ?? (await this.window(app, title));
		const args = { pid: window.pid, window_id: window.window_id, ...cuaArgs };
		let result = await this.call(name[1], args, true);
		if (result?.isError && text(result).includes("same_pid_keyboard_ambiguity"))
			result = await this.call(name[1], { ...args, delivery_mode: "foreground" });
		return result;
	}
	/**
	 * A click or menu step that fails falls back to the scenario's keyboard route, the way an agent
	 * does when pointer input cannot land (a session off the physical console). Every driver gets the
	 * same fallback, the oracle is unchanged, and each use is counted in keyboard_fallbacks.
	 */
	async step(step) {
		if (!step.keyboard || !["click-label", "menu"].includes(step.op)) return this.primaryStep(step);
		// apple-cua's windowContentNote tells the agent to use keyboard routes when window content is
		// unreachable, because window-level menu items can report success there and change nothing.
		if (!this.remoteApps.has(step.app)) {
			try {
				return await this.primaryStep(step);
			} catch (error) {
				if (String(error).includes("server-exit")) throw error;
				this.tokens.delete(step.app);
			}
		}
		this.keyboard_fallbacks += 1;
		let result;
		for (const key of step.keyboard)
			result = await this.primaryStep({ op: "key", app: step.app, title: step.title, ...key });
		return result;
	}

	async primaryStep(step) {
		const { app, title } = step;
		switch (step.op) {
			case "observe":
				return this.observe(app, title);
			case "type":
				return this.act(step, { text: step.value }, { text: step.value });
			case "menu":
				return this.act(step, { path: step.path }, { path: step.path });
			case "key":
				return this.act(
					step,
					{ keys: [step.apple ?? step.value] },
					{ key: step.cua ?? step.value, ...(step.modifiers ? { modifiers: step.modifiers } : {}) },
				);
			case "click-label": {
				if (this.efficient) {
					// `text` matches a label or a value: Finder names its list rows only in a text field's value.
					let result;
					try {
						result = await this.call("click_target", { app, query: { text: step.value } });
					} catch (error) {
						// Refused because the window moved since the last read (it was still settling after
						// opening); an agent re-observes and retries once.
						if (!/"needsExplicitObservation":\s*true/.test(String(error))) throw error;
						await this.observe(app, title);
						result = await this.call("click_target", { app, query: { text: step.value } });
					}
					const answer = parsed(result);
					// found=false is an honest non-error answer, but nothing was clicked: the step failed.
					if (answer.found === false || answer.actionDispatched === false)
						throw new Error(`element-missing: ${step.value}`);
					this.tokens.set(app, answer.observation_token);
					return result;
				}
				const observation = await this.observe(app, title);
				const elements = this.apple
					? (parsed(observation).elements ?? [])
					: (observation.structuredContent?.elements ?? []);
				const candidate = elements.find((e) =>
					String(e.label ?? e.title ?? e.name ?? e.value ?? "").includes(step.value),
				);
				if (!candidate) throw new Error(`element-missing: ${step.value}`);
				return this.act(
					step,
					{ element_index: String(candidate.id ?? candidate.index) },
					{ element_token: candidate.element_token },
				);
			}
			default:
				throw new Error(`unknown-step: ${step.op}`);
		}
	}
}

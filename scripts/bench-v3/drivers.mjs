import { Driver as V2Driver } from "../bench-v2/drivers.mjs";
import { accountPayload } from "../bench-v2/metrics.mjs";

const answer = (result) =>
	(result?.content ?? [])
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");

/** Retain identical logical plans, but never use v2's foreground retry. */
export class Driver extends V2Driver {
	constructor(kind, client) {
		if (!["apple", "cua"].includes(kind)) throw new Error(`unsupported driver: ${kind}`);
		super(kind, client);
		this.firstCallAt = null;
		this.lastCallAt = null;
		this.raw = [];
		this.allCallsSucceeded = true;
		this.lastTargets = new Map();
	}

	async call(name, input) {
		let args = input;
		if (args.delivery_mode === "foreground") throw new Error("needs-foreground: prohibited by benchmark");
		if (this.apple && ["get_app_state", "click_target"].includes(name) && args.window_id === undefined) {
			const window = this.windows.get(args.app);
			if (window) args = { ...args, window_id: window.window_id };
		}
		this.firstCallAt ??= performance.now();
		const started = performance.now();
		this.calls++;
		try {
			let result;
			try {
				result = await this.client.callTool(name, args);
			} finally {
				const elapsed = performance.now() - started;
				this.call_ms.push(elapsed);
				this.seconds += elapsed / 1000;
			}
			this.raw.push({ name, args, result });
			const payload = accountPayload(result);
			this.text_bytes += payload.text_bytes;
			this.image_base64_bytes += payload.image_base64_bytes;
			this.estimated_tokens += payload.estimated_tokens;
			this.image_tokens += payload.image_tokens;
			const text = answer(result);
			this.last = text;
			this.claimed ||=
				!["get_app_state", "get_window_state", "list_windows"].includes(name) &&
				/\b(verified|success|completed)\b/i.test(text) &&
				!/not verified|unverifiable/i.test(text) &&
				!result?.isError;
			this.human_ask ||= /ask the user|needs_user|elicitation/i.test(text);
			this.gave_up ||= /\b(refus(ed|al)|timed? out|timeout)\b/i.test(text);
			if (process.env.BENCH_TRACE === "1")
				this.trace.push({ name, args, error: result?.isError === true, answer: text });
			if (result?.isError) {
				this.allCallsSucceeded = false;
				throw new Error(`tool-error: ${answer(result)}`);
			}
			return result;
		} catch (error) {
			this.allCallsSucceeded = false;
			this.raw.push({ name, args, error: String(error) });
			throw error;
		} finally {
			this.lastCallAt = performance.now();
		}
	}

	get end_to_end_seconds() {
		return this.firstCallAt === null ? 0 : (this.lastCallAt - this.firstCallAt) / 1000;
	}

	async observe(app, title) {
		return super.observe(app, title ?? this.windows.get(app)?.title);
	}

	async act(step, appleArgs, cuaArgs) {
		if (this.apple) return super.act(step, appleArgs, cuaArgs);
		const window = this.windows.get(step.app) ?? (await this.window(step.app, step.title));
		const name = { type: "type_text", key: "press_key", "click-label": "click", menu: "invoke_menu" }[step.op];
		const args = {
			pid: window.pid,
			window_id: window.window_id,
			...(step.op === "menu" ? {} : { delivery_mode: "background" }),
			...cuaArgs,
		};
		if (step.op === "type" && this.lastTargets.has(step.app)) {
			// Re-observe before using a token: get_window_state supersedes that window's cache.
			const observation = await this.observe(step.app, step.title);
			const target = this.lastTargets.get(step.app);
			const field = observation.structuredContent?.elements?.find((element) =>
				[element.label, element.title, element.name, element.value].some((value) => value === target),
			);
			if (!field) throw new Error(`element-missing: ${target}`);
			args.element_token = field.element_token;
		}
		return this.call(name, args);
	}

	async primaryStep(step) {
		if (step.op === "click-label" && !this.apple) {
			const observation = await this.observe(step.app, step.title);
			const elements = observation.structuredContent?.elements ?? [];
			const candidate = elements.find((element) =>
				[element.label, element.title, element.name, element.value].some(
					(value) => typeof value === "string" && value.includes(step.value),
				),
			);
			if (!candidate) throw new Error(`element-missing: ${step.value}`);
			const result = await this.act(step, {}, { element_token: candidate.element_token });
			this.lastTargets.set(step.app, step.value);
			return result;
		}
		if (step.op === "key" && /cmd\+l|super\+l/.test(step.apple ?? "")) this.lastTargets.delete(step.app);
		return super.primaryStep(step);
	}
}

import { Driver } from "./drivers.mjs";

/** Browser-specific Cua background pixel typing from the documented screenshot frame. */
export class BrowserDriver extends Driver {
	async observe(app, title) {
		if (!this.apple) return super.observe(app, title);
		const ownedTitle = title ?? this.windows.get(app)?.title;
		if (!ownedTitle) throw new Error("owned fixture title required");
		const listed = await this.call("list_windows", {});
		const payload = listed.content.find((block) => block.type === "text" && block.text.trim().startsWith("{"));
		const window = JSON.parse(payload.text).windows.find(
			(item) => item.app === app && item.title?.endsWith(ownedTitle),
		);
		if (!window) throw new Error(`owned-visible-window-missing: ${app} ${ownedTitle}`);
		this.windows.set(app, window);
		const result = await this.call("get_app_state", {
			app,
			window_id: window.window_id,
			include_screenshot: false,
			include_accessibility_tree: true,
			element_format: "table",
			max_elements: 70,
		});
		const state = JSON.parse(
			result.content.find((block) => block.type === "text" && block.text.trim().startsWith("{")).text,
		);
		this.tokens.set(app, state.observation_token);
		return result;
	}
	async primaryStep(step) {
		if (step.op !== "click-label") return super.primaryStep(step);
		if (this.apple) {
			const window = this.windows.get(step.app);
			if (!window) throw new Error("owned window not observed");
			return this.call("run_script", {
				code: `return await apple.app(${JSON.stringify(step.app)},{window:${window.window_id}}).click(${JSON.stringify({ text: step.value })});`,
			});
		}
		const observation = await this.observe(step.app, step.title);
		const matches = (observation.structuredContent?.elements ?? []).filter((element) =>
			[element.label, element.title, element.name, element.value].some(
				(value) => typeof value === "string" && value.includes(step.value),
			),
		);
		const control = matches.find((element) =>
			["AXTextField", "AXTextArea", "AXLink", "AXButton"].includes(element.role),
		);
		if (!control) throw new Error(`actionable-element-missing: ${step.value}`);
		const result = await this.act(step, {}, { element_token: control.element_token });
		this.lastTargets.set(step.app, step.value);
		return result;
	}
	async window(app, title) {
		const ownedTitle = title ?? this.windows.get(app)?.title;
		if (!ownedTitle) throw new Error("owned fixture title required");
		const result = await this.call("list_windows", {});
		const candidates = result.structuredContent?.windows ?? [];
		const window = candidates.find((item) => item.app_name === app && item.title?.endsWith(ownedTitle));
		if (!window) throw new Error(`target-missing: ${app} ${ownedTitle}`);
		this.windows.set(app, window);
		return window;
	}
	async act(step, appleArgs, cuaArgs) {
		if (this.apple) {
			const window = this.windows.get(step.app);
			if (!window) throw new Error("owned window not observed");
			const method = { type: "type", key: "press", menu: "menu" }[step.op];
			if (!method) throw new Error(`unsupported action: ${step.op}`);
			const value = step.op === "menu" ? step.path : step.op === "key" ? (step.apple ?? step.value) : step.value;
			return this.call("run_script", {
				code: `return await apple.app(${JSON.stringify(step.app)},{window:${window.window_id}}).${method}(${JSON.stringify(value)});`,
			});
		}
		if (step.op !== "type" || !this.lastTargets.has(step.app)) return super.act(step, appleArgs, cuaArgs);
		const observation = await this.observe(step.app, step.title);
		const state = observation.structuredContent;
		const target = this.lastTargets.get(step.app);
		const field = state?.elements?.find(
			(element) =>
				["AXTextField", "AXTextArea"].includes(element.role) &&
				[element.label, element.title, element.name].some((value) => value === target),
		);
		const frame = field?.screenshot_frame;
		if (!frame || !state.screenshot_frame_valid || frame.w <= 0 || frame.h <= 0)
			throw new Error(`unprovable-pixel-frame: ${target}`);
		return this.call("type_text", {
			pid: state.pid,
			window_id: state.window_id,
			delivery_mode: "background",
			x: frame.x + frame.w / 2,
			y: frame.y + frame.h / 2,
			text: step.value,
		});
	}
}

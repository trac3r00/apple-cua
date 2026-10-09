/** Desktop tools that only the full toolset registers: element actions, batching, and OS helpers. */
export const FULL_ONLY_TOOL_NAMES = [
	"click",
	"click_target",
	"perform_secondary_action",
	"set_value",
	"set_fields",
	"run_steps",
	"observe_apps",
	"run_parallel",
	"select_text",
	"drag",
	"scroll",
	"type_text",
	"press_keys",
	"invoke_menu",
	"set_window_frame",
	"clipboard_read",
	"clipboard_write",
] as const;

/** The small observe / script / verify surface registered by `APPLE_CUA_TOOLSET=lean`. */
export const LEAN_TOOL_NAMES = [
	"list_apps",
	"open_app",
	"list_windows",
	"get_app_state",
	"find_elements",
	"run_script",
	"get_capabilities",
	"verify_state",
	"ask_user",
] as const;

/** Opt-in iPhone Mirroring tools, registered only with `APPLE_CUA_IPHONE=1`. */
export const IPHONE_TOOL_NAMES = [
	"ios_observe",
	"ios_find_text",
	"ios_screenshot",
	"ios_tap",
	"ios_tap_text",
	"ios_long_press",
	"ios_swipe",
	"ios_scroll",
	"ios_type_text",
	"ios_press_keys",
	"ios_home",
	"ios_app_switcher",
	"ios_open_app",
] as const;

/** Every tool this server can ever register (full toolset plus iPhone). */
export const TOOL_NAMES = [...LEAN_TOOL_NAMES, ...FULL_ONLY_TOOL_NAMES, ...IPHONE_TOOL_NAMES] as const;

/** Tools registered for one configuration: lean or full desktop, plus iPhone when enabled. */
export function toolNamesFor(toolset: "full" | "lean", iphone: boolean): readonly string[] {
	return [
		...LEAN_TOOL_NAMES,
		...(toolset === "full" ? FULL_ONLY_TOOL_NAMES : []),
		...(iphone ? IPHONE_TOOL_NAMES : []),
	];
}

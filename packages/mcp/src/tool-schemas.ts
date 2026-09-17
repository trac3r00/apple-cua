import { z } from "zod/v4";

const appSchema = z.string().min(1);
const observationTokenSchema = z.string().min(1);
const elementIndexSchema = z.string();
const coordinateSchema = z.number();
const fullStateSchema = z.boolean().optional();
const includeScreenshotSchema = z.boolean().optional();

/** Upper bound for one verified field-update call, so a single request stays reviewable. */
export const MAX_SET_FIELD_UPDATES = 10;
/** Upper bound for one ordered action batch, so a single request stays reviewable. */
export const MAX_RUN_STEPS = 10;
/** Upper bound for the matches one element query answers with. */
export const MAX_FIND_RESULTS = 25;

export const emptySchema = z.object({});

export const iosObserveSchema = z.object({});
export const iosScreenshotSchema = z.object({ path: z.string().min(1).optional() });
const phoneToken = { observation_token: observationTokenSchema };
const phonePoint = { x: z.number().finite(), y: z.number().finite() };
export const iosTapSchema = z.object({ ...phoneToken, ...phonePoint });
export const iosTapTextSchema = z.object({
	...phoneToken,
	query: z.string().min(1),
	index: z.number().int().nonnegative().optional(),
	exact: z.boolean().optional(),
});
export const iosLongPressSchema = z.object({
	...phoneToken,
	...phonePoint,
	duration_ms: z.number().positive().optional(),
});
const directions = z.enum(["up", "down", "left", "right"]);
const at = { at: z.object(phonePoint).optional() };
export const iosSwipeSchema = z.object({
	...phoneToken,
	direction: directions,
	distance: z.number().positive().optional(),
	kind: z.enum(["flick", "drag"]).optional(),
	...at,
});
export const iosScrollSchema = z.object({
	...phoneToken,
	direction: directions,
	amount: z.number().positive().optional(),
	...at,
});
export const iosTypeTextSchema = z.object({
	...phoneToken,
	text: z.string(),
	mode: z.enum(["paste", "keystrokes"]).optional(),
});
export const iosPressKeysSchema = z.object({ ...phoneToken, combo: z.string().min(1) });
export const iosHomeSchema = z.object({ ...phoneToken });
export const iosAppSwitcherSchema = z.object({ ...phoneToken });
export const iosOpenAppSchema = z.object({ ...phoneToken, name: z.string().min(1) });

const MAX_VERIFY_CHECKS = 10;

const verifyCheckFields = {
	element_index: elementIndexSchema,
	exists: z.boolean().optional(),
	value: z.string().optional(),
	label: z.string().optional(),
};

/**
 * The outcome an action promises to produce, checked after it dispatched (and, with a timeout,
 * polled until it holds). One shape is shared by verify_state, run_steps, and click_target so a
 * check written for one call means the same thing in the others.
 */
const verifyExpectSchema = z.object({
	checks: z.array(z.object(verifyCheckFields)).max(MAX_VERIFY_CHECKS).optional(),
	window_title: z.string().optional(),
	timeout_ms: z.number().int().positive().max(10_000).optional(),
});

/**
 * One described element: every field given must hold. Role matching ignores the AX prefix and
 * case; label matching collapses whitespace; the needles are case-insensitive substrings.
 */
export const elementQuerySchema = z
	.object({
		role: z.string().min(1).optional(),
		label: z.string().min(1).optional(),
		label_contains: z.string().min(1).optional(),
		value_contains: z.string().min(1).optional(),
		text: z.string().min(1).optional(),
	})
	.refine(
		(query) =>
			[query.role, query.label, query.label_contains, query.value_contains, query.text].some(
				(field) => field !== undefined,
			),
		{ message: "a query needs at least one of role, label, label_contains, value_contains, or text" },
	);

export const verifyStateSchema = z.object({
	app: appSchema,
	observation_token: observationTokenSchema,
	...verifyExpectSchema.shape,
});

export const getAppStateSchema = z.object({
	app: appSchema,
	diff_only: z.boolean().optional(),
	include_screenshot: z.boolean().optional(),
	include_accessibility_tree: z.boolean().optional(),
	window_id: z.number().int().positive().optional(),
	settle_ms: z.number().int().nonnegative().optional(),
	max_elements: z.number().int().positive().optional(),
	include_menu_bar: z.boolean().optional(),
	subtree_of: z.number().int().nonnegative().optional(),
});

const clickFields = {
	element_index: elementIndexSchema.optional(),
	x: coordinateSchema.optional(),
	y: coordinateSchema.optional(),
	click_count: z.number().int().positive().optional(),
	mouse_button: z.enum(["left", "right", "middle"]).optional(),
};

export const clickSchema = z.object({
	app: appSchema,
	observation_token: observationTokenSchema,
	...clickFields,
	full_state: fullStateSchema,
	include_screenshot: includeScreenshotSchema,
});

export const findElementsSchema = z.object({
	app: appSchema,
	query: elementQuerySchema,
	window_id: z.number().int().positive().optional(),
	max_results: z.number().int().positive().max(MAX_FIND_RESULTS).optional(),
	max_elements: z.number().int().positive().optional(),
	include_screenshot: includeScreenshotSchema,
});

export const clickTargetSchema = z.object({
	app: appSchema,
	query: elementQuerySchema,
	window_id: z.number().int().positive().optional(),
	index: z.number().int().nonnegative().optional(),
	timeout_ms: z.number().int().nonnegative().max(10_000).optional(),
	press: z.enum(["auto", "accessibility", "pointer"]).optional(),
	hover_first: z.boolean().optional(),
	click_count: z.number().int().positive().optional(),
	mouse_button: z.enum(["left", "right", "middle"]).optional(),
	expect: verifyExpectSchema.optional(),
	full_state: fullStateSchema,
	include_screenshot: includeScreenshotSchema,
});

export const openAppSchema = z.object({
	name: z.string().min(1),
	timeout_ms: z.number().int().positive().max(30_000).optional(),
});

const performSecondaryActionFields = {
	element_index: elementIndexSchema,
	action: z.string().min(1),
};

export const performSecondaryActionSchema = z.object({
	app: appSchema,
	observation_token: observationTokenSchema,
	...performSecondaryActionFields,
	full_state: fullStateSchema,
	include_screenshot: includeScreenshotSchema,
});

const setValueFields = {
	element_index: elementIndexSchema,
	value: z.string(),
};

export const setValueSchema = z.object({
	app: appSchema,
	observation_token: observationTokenSchema,
	...setValueFields,
	full_state: fullStateSchema,
	include_screenshot: includeScreenshotSchema,
});

export const setFieldsSchema = z.object({
	app: appSchema,
	observation_token: observationTokenSchema,
	updates: z
		.array(
			z.object({
				element_index: elementIndexSchema,
				value: z.string(),
			}),
		)
		.min(1)
		.max(MAX_SET_FIELD_UPDATES),
	full_state: fullStateSchema,
	include_screenshot: includeScreenshotSchema,
});

const selectTextFields = {
	element_index: elementIndexSchema,
	text: z.string().optional(),
	prefix: z.string().optional(),
	suffix: z.string().optional(),
	selection: z.enum(["text", "before", "after"]).optional(),
};

export const selectTextSchema = z.object({
	app: appSchema,
	observation_token: observationTokenSchema,
	...selectTextFields,
	full_state: fullStateSchema,
	include_screenshot: includeScreenshotSchema,
});

const dragFields = {
	from_x: coordinateSchema,
	from_y: coordinateSchema,
	to_x: coordinateSchema,
	to_y: coordinateSchema,
};

export const dragSchema = z.object({
	app: appSchema,
	observation_token: observationTokenSchema,
	...dragFields,
	full_state: fullStateSchema,
	include_screenshot: includeScreenshotSchema,
});

const scrollFields = {
	direction: z.enum(["up", "down", "left", "right"]),
	element_index: elementIndexSchema,
	pages: z.number().positive().optional(),
};

export const scrollSchema = z.object({
	app: appSchema,
	observation_token: observationTokenSchema,
	...scrollFields,
	full_state: fullStateSchema,
	include_screenshot: includeScreenshotSchema,
});

const typeTextFields = {
	text: z.string(),
};

export const typeTextSchema = z.object({
	app: appSchema,
	observation_token: observationTokenSchema,
	...typeTextFields,
	full_state: fullStateSchema,
	include_screenshot: includeScreenshotSchema,
});

const keySequenceEntrySchema = z.union([
	z.string().min(1),
	z.object({
		key: z.string().min(1),
		hold_seconds: z.number().nonnegative().optional(),
	}),
]);

const pressKeysFields = {
	keys: z.array(keySequenceEntrySchema).min(1),
	hold_seconds: z.number().nonnegative().optional(),
	interval_seconds: z.number().nonnegative().optional(),
};

export const pressKeysSchema = z.object({
	app: appSchema,
	observation_token: observationTokenSchema,
	...pressKeysFields,
	full_state: fullStateSchema,
	include_screenshot: includeScreenshotSchema,
});

/**
 * One ordered action inside a run_steps batch. Element ids always refer to the token
 * observation: a batch cannot name elements that only appear after an earlier step ran,
 * so anything that must react to new UI still needs the returned continuation token.
 */
export const runStepSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("click"), ...clickFields }),
	z.object({ type: z.literal("perform_secondary_action"), ...performSecondaryActionFields }),
	z.object({ type: z.literal("set_value"), ...setValueFields }),
	z.object({ type: z.literal("select_text"), ...selectTextFields }),
	z.object({ type: z.literal("drag"), ...dragFields }),
	z.object({ type: z.literal("scroll"), ...scrollFields }),
	z.object({ type: z.literal("type_text"), ...typeTextFields }),
	z.object({ type: z.literal("press_keys"), ...pressKeysFields }),
	z.object({ type: z.literal("invoke_menu"), path: z.array(z.string()).min(1).max(16) }),
	z.object({
		type: z.literal("set_window_frame"),
		x: z.number().finite(),
		y: z.number().finite(),
		width: z.number().positive().finite(),
		height: z.number().positive().finite(),
	}),
	z.object({
		type: z.literal("clipboard_write"),
		text: z.string().optional(),
		image_path: z.string().optional(),
		file_path: z.string().optional(),
	}),
]);

export const runStepsSchema = z.object({
	app: appSchema,
	observation_token: observationTokenSchema,
	steps: z.array(runStepSchema).min(1).max(MAX_RUN_STEPS),
	expect: verifyExpectSchema.optional(),
	full_state: fullStateSchema,
	include_screenshot: includeScreenshotSchema,
});

export type ClickInput = z.infer<typeof clickSchema>;
export type ClickTargetInput = z.infer<typeof clickTargetSchema>;
export type DragInput = z.infer<typeof dragSchema>;
export type FindElementsInput = z.infer<typeof findElementsSchema>;
export type OpenAppInput = z.infer<typeof openAppSchema>;
export type PressKeysInput = z.infer<typeof pressKeysSchema>;
export type SelectTextInput = z.infer<typeof selectTextSchema>;
export type SetFieldsInput = z.infer<typeof setFieldsSchema>;
export type RunStep = z.infer<typeof runStepSchema>;
export type RunStepsInput = z.infer<typeof runStepsSchema>;

export type ClickActionInput = Omit<ClickInput, "app" | "observation_token" | "full_state">;
export type DragActionInput = Omit<DragInput, "app" | "observation_token" | "full_state">;
export type PressKeysActionInput = Omit<PressKeysInput, "app" | "observation_token" | "full_state">;
export type SelectTextActionInput = Omit<SelectTextInput, "app" | "observation_token" | "full_state">;

import { z } from "zod/v4";

const appSchema = z.string().min(1);
const observationTokenSchema = z.string().min(1);
const elementIndexSchema = z.string();
const coordinateSchema = z.number();
const fullStateSchema = z.boolean().optional();

/** Upper bound for one verified field-update call, so a single request stays reviewable. */
export const MAX_SET_FIELD_UPDATES = 10;
/** Upper bound for one ordered action batch, so a single request stays reviewable. */
export const MAX_RUN_STEPS = 10;

export const emptySchema = z.object({});

const MAX_VERIFY_CHECKS = 10;

const verifyCheckFields = {
	element_index: elementIndexSchema,
	exists: z.boolean().optional(),
	value: z.string().optional(),
	label: z.string().optional(),
};

export const verifyStateSchema = z.object({
	app: appSchema,
	observation_token: observationTokenSchema,
	checks: z.array(z.object(verifyCheckFields)).max(MAX_VERIFY_CHECKS).optional(),
	window_title: z.string().optional(),
	timeout_ms: z.number().int().positive().max(10_000).optional(),
});

export const getAppStateSchema = z.object({
	app: appSchema,
	diff_only: z.boolean().optional(),
	include_screenshot: z.boolean().optional(),
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
});

const typeTextFields = {
	text: z.string(),
};

export const typeTextSchema = z.object({
	app: appSchema,
	observation_token: observationTokenSchema,
	...typeTextFields,
	full_state: fullStateSchema,
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
	expect: z
		.object({
			checks: z.array(z.object(verifyCheckFields)).max(MAX_VERIFY_CHECKS).optional(),
			window_title: z.string().optional(),
			timeout_ms: z.number().int().positive().max(10_000).optional(),
		})
		.optional(),
	full_state: fullStateSchema,
});

export type ClickInput = z.infer<typeof clickSchema>;
export type DragInput = z.infer<typeof dragSchema>;
export type PressKeysInput = z.infer<typeof pressKeysSchema>;
export type SelectTextInput = z.infer<typeof selectTextSchema>;
export type SetFieldsInput = z.infer<typeof setFieldsSchema>;
export type RunStep = z.infer<typeof runStepSchema>;
export type RunStepsInput = z.infer<typeof runStepsSchema>;

export type ClickActionInput = Omit<ClickInput, "app" | "observation_token" | "full_state">;
export type DragActionInput = Omit<DragInput, "app" | "observation_token" | "full_state">;
export type PressKeysActionInput = Omit<PressKeysInput, "app" | "observation_token" | "full_state">;
export type SelectTextActionInput = Omit<SelectTextInput, "app" | "observation_token" | "full_state">;

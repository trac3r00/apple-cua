import { z } from "zod/v4";

const appSchema = z.string().min(1);
const observationTokenSchema = z.string().min(1);
const elementIndexSchema = z.string();
const coordinateSchema = z.number();
const fullStateSchema = z.boolean().optional();

/** Upper bound for one verified field-update call, so a single request stays reviewable. */
export const MAX_SET_FIELD_UPDATES = 10;

export const emptySchema = z.object({});

const MAX_VERIFY_CHECKS = 10;

export const verifyStateSchema = z.object({
	app: appSchema,
	observation_token: observationTokenSchema,
	checks: z
		.array(
			z.object({
				element_index: elementIndexSchema,
				exists: z.boolean().optional(),
				value: z.string().optional(),
				label: z.string().optional(),
			}),
		)
		.max(MAX_VERIFY_CHECKS)
		.optional(),
	window_title: z.string().optional(),
	timeout_ms: z.number().int().positive().max(10_000).optional(),
});

export const getAppStateSchema = z.object({
	app: appSchema,
	diff_only: z.boolean().optional(),
	include_screenshot: z.boolean().optional(),
	max_elements: z.number().int().positive().optional(),
	include_menu_bar: z.boolean().optional(),
});

export const clickSchema = z.object({
	app: appSchema,
	observation_token: observationTokenSchema,
	element_index: elementIndexSchema.optional(),
	x: coordinateSchema.optional(),
	y: coordinateSchema.optional(),
	click_count: z.number().int().positive().optional(),
	mouse_button: z.enum(["left", "right", "middle"]).optional(),
	full_state: fullStateSchema,
});

export const performSecondaryActionSchema = z.object({
	app: appSchema,
	observation_token: observationTokenSchema,
	element_index: elementIndexSchema,
	action: z.string().min(1),
	full_state: fullStateSchema,
});

export const setValueSchema = z.object({
	app: appSchema,
	observation_token: observationTokenSchema,
	element_index: elementIndexSchema,
	value: z.string(),
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

export const selectTextSchema = z.object({
	app: appSchema,
	observation_token: observationTokenSchema,
	element_index: elementIndexSchema,
	text: z.string().optional(),
	prefix: z.string().optional(),
	suffix: z.string().optional(),
	selection: z.enum(["text", "before", "after"]).optional(),
	full_state: fullStateSchema,
});

export const dragSchema = z.object({
	app: appSchema,
	observation_token: observationTokenSchema,
	from_x: coordinateSchema,
	from_y: coordinateSchema,
	to_x: coordinateSchema,
	to_y: coordinateSchema,
	full_state: fullStateSchema,
});

export const scrollSchema = z.object({
	app: appSchema,
	observation_token: observationTokenSchema,
	direction: z.enum(["up", "down", "left", "right"]),
	element_index: elementIndexSchema,
	pages: z.number().positive().optional(),
	full_state: fullStateSchema,
});

export const typeTextSchema = z.object({
	app: appSchema,
	observation_token: observationTokenSchema,
	text: z.string(),
	full_state: fullStateSchema,
});

const keySequenceEntrySchema = z.union([
	z.string().min(1),
	z.object({
		key: z.string().min(1),
		hold_seconds: z.number().nonnegative().optional(),
	}),
]);

export const pressKeysSchema = z.object({
	app: appSchema,
	observation_token: observationTokenSchema,
	keys: z.array(keySequenceEntrySchema).min(1),
	hold_seconds: z.number().nonnegative().optional(),
	interval_seconds: z.number().nonnegative().optional(),
	full_state: fullStateSchema,
});

export type ClickInput = z.infer<typeof clickSchema>;
export type DragInput = z.infer<typeof dragSchema>;
export type PressKeysInput = z.infer<typeof pressKeysSchema>;
export type SelectTextInput = z.infer<typeof selectTextSchema>;
export type SetFieldsInput = z.infer<typeof setFieldsSchema>;

import { z } from "zod/v4";

const appSchema = z.string().min(1);
const observationTokenSchema = z.string().min(1);
const elementIndexSchema = z.string();
const coordinateSchema = z.number();

export const emptySchema = z.object({});

export const getAppStateSchema = z.object({
	app: appSchema,
	diff_only: z.boolean().optional(),
});

export const clickSchema = z.object({
	app: appSchema,
	observation_token: observationTokenSchema,
	element_index: elementIndexSchema.optional(),
	x: coordinateSchema.optional(),
	y: coordinateSchema.optional(),
	click_count: z.number().int().positive().optional(),
	mouse_button: z.enum(["left", "right", "middle"]).optional(),
});

export const performSecondaryActionSchema = z.object({
	app: appSchema,
	observation_token: observationTokenSchema,
	element_index: elementIndexSchema,
	action: z.string().min(1),
});

export const setValueSchema = z.object({
	app: appSchema,
	observation_token: observationTokenSchema,
	element_index: elementIndexSchema,
	value: z.string(),
});

export const selectTextSchema = z.object({
	app: appSchema,
	observation_token: observationTokenSchema,
	element_index: elementIndexSchema,
	text: z.string().optional(),
	prefix: z.string().optional(),
	suffix: z.string().optional(),
	selection: z.enum(["text", "before", "after"]).optional(),
});

export const dragSchema = z.object({
	app: appSchema,
	observation_token: observationTokenSchema,
	from_x: coordinateSchema,
	from_y: coordinateSchema,
	to_x: coordinateSchema,
	to_y: coordinateSchema,
});

export const scrollSchema = z.object({
	app: appSchema,
	observation_token: observationTokenSchema,
	direction: z.enum(["up", "down", "left", "right"]),
	element_index: elementIndexSchema,
	pages: z.number().positive().optional(),
});

export const typeTextSchema = z.object({
	app: appSchema,
	observation_token: observationTokenSchema,
	text: z.string(),
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
});

export type ClickInput = z.infer<typeof clickSchema>;
export type DragInput = z.infer<typeof dragSchema>;
export type PressKeysInput = z.infer<typeof pressKeysSchema>;
export type SelectTextInput = z.infer<typeof selectTextSchema>;

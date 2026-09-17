import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../pi/index.js";
import { type PhoneObservationKeys, phoneTool } from "./ios-shared.js";

const Direction = Type.Union([Type.Literal("up"), Type.Literal("down"), Type.Literal("left"), Type.Literal("right")]);
export const IosSwipeParams = Type.Object(
	{
		direction: Direction,
		distance: Type.Optional(Type.Number({ minimum: 0 })),
		kind: Type.Optional(Type.Union([Type.Literal("flick"), Type.Literal("drag")])),
		x: Type.Optional(Type.Number()),
		y: Type.Optional(Type.Number()),
	},
	{ additionalProperties: false },
);
export type IosSwipeInput = Static<typeof IosSwipeParams>;
export function createIosSwipeTool(keys: PhoneObservationKeys): ToolDefinition {
	return phoneTool(
		"ios_swipe",
		"iPhone: swipe",
		"Swipe the iPhone screen in the direction the finger moves (up means the finger moves up). Requires a current ios_observe first.",
		IosSwipeParams,
		keys,
		async (phone, params: IosSwipeInput) => {
			const at = params.x === undefined || params.y === undefined ? undefined : { x: params.x, y: params.y };
			await phone.swipe(params.direction, {
				...(params.distance === undefined ? {} : { distance: params.distance }),
				...(params.kind === undefined ? {} : { kind: params.kind }),
				...(at === undefined ? {} : { at }),
			});
			return undefined;
		},
	);
}

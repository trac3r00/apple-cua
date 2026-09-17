import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../pi/index.js";
import { type PhoneObservationKeys, phoneTool } from "./ios-shared.js";

const Direction = Type.Union([Type.Literal("up"), Type.Literal("down"), Type.Literal("left"), Type.Literal("right")]);
export const IosScrollParams = Type.Object(
	{
		direction: Direction,
		amount: Type.Optional(Type.Number({ minimum: 0 })),
		x: Type.Optional(Type.Number()),
		y: Type.Optional(Type.Number()),
	},
	{ additionalProperties: false },
);
export type IosScrollInput = Static<typeof IosScrollParams>;
export function createIosScrollTool(keys: PhoneObservationKeys): ToolDefinition {
	return phoneTool(
		"ios_scroll",
		"iPhone: scroll",
		"Scroll iPhone content in the direction you want to see (down reveals content further down). Requires a current ios_observe first.",
		IosScrollParams,
		keys,
		async (phone, params: IosScrollInput) => {
			const at = params.x === undefined || params.y === undefined ? undefined : { x: params.x, y: params.y };
			await phone.scroll(params.direction, {
				...(params.amount === undefined ? {} : { amount: params.amount }),
				...(at === undefined ? {} : { at }),
			});
			return undefined;
		},
	);
}

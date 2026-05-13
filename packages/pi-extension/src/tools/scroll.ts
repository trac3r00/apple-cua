import type { MacOSHostComputer } from "@macos-cua/core";

export interface ScrollToolResult {
	content: Array<{ type: "text"; text: string }>;
}

export async function scroll(
	computer: MacOSHostComputer,
	args: { direction: "up" | "down" | "left" | "right"; amount: number },
): Promise<ScrollToolResult> {
	await computer.scroll({ direction: args.direction, amount: args.amount });
	return {
		content: [
			{
				type: "text",
				text: `Scrolled ${args.direction} by ${args.amount}`,
			},
		],
	};
}

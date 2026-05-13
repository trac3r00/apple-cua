import type { MacOSHostComputer } from "@macos-cua/core";

export interface DragToolResult {
	content: Array<{ type: "text"; text: string }>;
}

export async function drag(
	computer: MacOSHostComputer,
	args: { fromX: number; fromY: number; toX: number; toY: number },
): Promise<DragToolResult> {
	await computer.drag({
		from: { x: args.fromX, y: args.fromY },
		to: { x: args.toX, y: args.toY },
	});
	return {
		content: [
			{
				type: "text",
				text: `Dragged from ${args.fromX},${args.fromY} to ${args.toX},${args.toY}`,
			},
		],
	};
}

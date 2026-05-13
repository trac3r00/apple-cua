import type { MacOSHostComputer } from "@macos-cua/core";

export interface DoubleClickToolResult {
	content: Array<{ type: "text"; text: string }>;
}

export async function doubleClick(
	computer: MacOSHostComputer,
	args: { x: number; y: number },
): Promise<DoubleClickToolResult> {
	await computer.doubleClick({ x: args.x, y: args.y });
	return {
		content: [{ type: "text", text: `Double-clicked at ${args.x},${args.y}` }],
	};
}

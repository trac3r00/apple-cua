import type { MacOSHostComputer } from "@macos-cua/core";

export interface ClickToolResult {
	content: Array<{ type: "text"; text: string }>;
}

export async function click(computer: MacOSHostComputer, args: { x: number; y: number }): Promise<ClickToolResult> {
	await computer.click({ x: args.x, y: args.y });
	return {
		content: [{ type: "text", text: `Clicked at ${args.x},${args.y}` }],
	};
}

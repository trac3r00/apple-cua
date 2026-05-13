import type { MacOSHostComputer } from "@macos-cua/core";

export interface TypeToolResult {
	content: Array<{ type: "text"; text: string }>;
}

export async function typeText(computer: MacOSHostComputer, args: { text: string }): Promise<TypeToolResult> {
	await computer.type(args.text);
	return {
		content: [{ type: "text", text: `Typed: ${args.text}` }],
	};
}

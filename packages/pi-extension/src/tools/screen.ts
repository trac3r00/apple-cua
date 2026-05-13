import type { MacOSHostComputer } from "@macos-cua/core";

export interface ScreenToolResult {
	content: Array<{ type: "text"; text: string }>;
}

export async function screenSize(computer: MacOSHostComputer): Promise<ScreenToolResult> {
	const size = await computer.getScreenSize();
	return {
		content: [{ type: "text", text: `Screen size: ${size.width}x${size.height}` }],
	};
}

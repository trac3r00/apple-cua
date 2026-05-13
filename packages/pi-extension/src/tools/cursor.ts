import type { MacOSHostComputer } from "@macos-cua/core";

export interface CursorToolResult {
	content: Array<{ type: "text"; text: string }>;
}

export async function cursorPosition(computer: MacOSHostComputer): Promise<CursorToolResult> {
	const pos = await computer.getCursorPosition();
	return {
		content: [{ type: "text", text: `Cursor position: ${pos.x},${pos.y}` }],
	};
}

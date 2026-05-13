import type { MacOSHostComputer } from "@macos-cua/core";

export interface KeyToolResult {
	content: Array<{ type: "text"; text: string }>;
}

export async function key(
	computer: MacOSHostComputer,
	args: { key: string; modifiers?: Array<string> },
): Promise<KeyToolResult> {
	const modifiers = args.modifiers?.map((m) => {
		switch (m) {
			case "cmd":
				return "command";
			case "alt":
				return "option";
			case "ctrl":
				return "control";
			case "shift":
				return "shift";
			default:
				return m as "command" | "option" | "control" | "shift";
		}
	});
	await computer.key(args.key, modifiers ? { modifiers } : undefined);
	return {
		content: [
			{
				type: "text",
				text: `Pressed key: ${args.key}${modifiers ? ` with ${modifiers.join("+")}` : ""}`,
			},
		],
	};
}

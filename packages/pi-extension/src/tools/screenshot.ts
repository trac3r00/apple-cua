import type { MacOSHostComputer } from "@macos-cua/core";

export interface ScreenshotToolResult {
	content: Array<
		{ type: "image"; data: string; mimeType: "image/png" | "image/jpeg" } | { type: "text"; text: string }
	>;
}

export async function screenshot(
	computer: MacOSHostComputer,
	args: { region?: { x: number; y: number; width: number; height: number } },
): Promise<ScreenshotToolResult> {
	const result = await computer.screenshot(
		args.region
			? {
					region: args.region,
				}
			: undefined,
	);

	return {
		content: [
			{
				type: "image",
				data: result.data.toString("base64"),
				mimeType: result.mimeType,
			},
			{
				type: "text",
				text: `Screenshot captured (${result.width}x${result.height})`,
			},
		],
	};
}

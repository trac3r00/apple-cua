const APP_INSTRUCTIONS: ReadonlyMap<string, string> = new Map([
	[
		"com.apple.clock",
		[
			"Clock has World Clock, Alarm, Stopwatch, and Timer tabs in the toolbar.",
			"Before changing a timer or stopwatch, read its current state from the accessibility tree.",
			"Set timer hour/minute/second sliders by focusing each field and typing the value; never exceed 23:59:59.",
		].join("\n"),
	],
	[
		"notion.id",
		[
			"Notion documents are made of blocks. Press Return to edit a selected block.",
			"Insert one line at a time and press Return; format with Markdown syntax.",
			"Typing removes placeholder text, so never select and delete placeholders.",
		].join("\n"),
	],
]);

export function resolveAppInstructions(appName: string, bundleId: string): string | undefined {
	return APP_INSTRUCTIONS.get(bundleId.toLowerCase()) ?? APP_INSTRUCTIONS.get(appName.toLowerCase());
}

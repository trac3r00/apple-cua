import type { MacOSHostComputer } from "@macos-cua/core";
import type { ExtensionAPI, ToolDefinition } from "../pi/index.js";

import { createClickTool } from "./click.js";
import { createCursorPositionTool } from "./cursor.js";
import { createDoubleClickTool } from "./doubleClick.js";
import { createDragTool } from "./drag.js";
import { createKeyTool } from "./key.js";
import { createScreenSizeTool } from "./screen.js";
import { createScreenshotTool } from "./screenshot.js";
import { createScrollTool } from "./scroll.js";
import { createTypeTool } from "./type.js";

export interface ToolRegistrationOptions {
	readonly computer: MacOSHostComputer;
}

export function buildAllTools(options: ToolRegistrationOptions): ReadonlyArray<ToolDefinition> {
	const { computer } = options;
	return [
		createScreenshotTool(computer),
		createClickTool(computer),
		createTypeTool(computer),
		createKeyTool(computer),
		createScrollTool(computer),
		createDoubleClickTool(computer),
		createDragTool(computer),
		createCursorPositionTool(computer),
		createScreenSizeTool(computer),
	];
}

export function registerAllTools(pi: ExtensionAPI, options: ToolRegistrationOptions): void {
	for (const tool of buildAllTools(options)) {
		pi.registerTool(tool);
	}
}

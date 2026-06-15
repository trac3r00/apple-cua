import type { ComputerInterface } from "@macos-cua/core";
import type { ExtensionAPI, ToolDefinition } from "../pi/index.js";

import { createClickTool } from "./click.js";
import { createDragTool } from "./drag.js";
import { createGetAppStateTool } from "./get-app-state.js";
import { createListAppsTool } from "./list-apps.js";
import { createPerformSecondaryActionTool } from "./perform-secondary-action.js";
import { createPressKeysTool } from "./press-key.js";
import { createScrollTool } from "./scroll.js";
import { createSelectTextTool } from "./select-text.js";
import { createSetValueTool } from "./set-value.js";
import { createTypeTextTool } from "./type-text.js";

export interface ToolRegistrationOptions {
	readonly computer: ComputerInterface;
}

export function buildAllTools(options: ToolRegistrationOptions): ReadonlyArray<ToolDefinition> {
	const { computer } = options;
	return [
		createListAppsTool(computer),
		createGetAppStateTool(computer),
		createClickTool(computer),
		createPerformSecondaryActionTool(computer),
		createSetValueTool(computer),
		createSelectTextTool(computer),
		createDragTool(computer),
		createScrollTool(computer),
		createTypeTextTool(computer),
		createPressKeysTool(computer),
	];
}

export function registerAllTools(pi: ExtensionAPI, options: ToolRegistrationOptions): void {
	for (const tool of buildAllTools(options)) {
		pi.registerTool(tool);
	}
}

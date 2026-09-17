import type { ComputerInterface } from "@apple-cua/core";
import type { ExtensionAPI, ToolDefinition } from "../pi/index.js";

import { createClickTool } from "./click.js";
import { createDragTool } from "./drag.js";
import { createGetAppStateTool } from "./get-app-state.js";
import { createIosHomeTool } from "./ios-home.js";
import { createIosObserveTool } from "./ios-observe.js";
import { createIosOpenAppTool } from "./ios-open-app.js";
import { createIosPressKeysTool } from "./ios-press-keys.js";
import { createIosScrollTool } from "./ios-scroll.js";
import { PhoneObservationKeys } from "./ios-shared.js";
import { createIosSwipeTool } from "./ios-swipe.js";
import { createIosTapTextTool } from "./ios-tap-text.js";
import { createIosTapTool } from "./ios-tap.js";
import { createIosTypeTextTool } from "./ios-type-text.js";
import { createListAppsTool } from "./list-apps.js";
import { AppObservationKeys } from "./observations.js";
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
	const observations = new AppObservationKeys();
	const phoneObservations = new PhoneObservationKeys();
	return [
		createListAppsTool(computer),
		createGetAppStateTool(computer, observations),
		createClickTool(computer, observations),
		createPerformSecondaryActionTool(computer, observations),
		createSetValueTool(computer, observations),
		createSelectTextTool(computer, observations),
		createDragTool(computer, observations),
		createScrollTool(computer),
		createTypeTextTool(computer),
		createPressKeysTool(computer),
		createIosObserveTool(phoneObservations),
		createIosTapTool(phoneObservations),
		createIosTapTextTool(phoneObservations),
		createIosTypeTextTool(phoneObservations),
		createIosPressKeysTool(phoneObservations),
		createIosScrollTool(phoneObservations),
		createIosSwipeTool(phoneObservations),
		createIosHomeTool(phoneObservations),
		createIosOpenAppTool(phoneObservations),
	];
}

export function registerAllTools(pi: ExtensionAPI, options: ToolRegistrationOptions): void {
	for (const tool of buildAllTools(options)) {
		pi.registerTool(tool);
	}
}

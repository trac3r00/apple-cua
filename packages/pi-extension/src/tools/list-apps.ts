import type { ComputerInterface } from "@macos-cua/core";
import { Type } from "typebox";

import { type ToolDefinition, defineTool } from "../pi/index.js";
import { textResult } from "./result.js";

const EmptyParams = Type.Object({}, { additionalProperties: false });

export function createListAppsTool(computer: ComputerInterface): ToolDefinition {
	return defineTool({
		name: "list_apps",
		label: "Computer Use: list apps",
		description:
			"List the apps on this computer. Returns the set of apps that are currently running, including details on usage frequency where available.",
		parameters: EmptyParams,
		async execute() {
			return textResult(JSON.stringify(await computer.listApps(), null, 2));
		},
	});
}

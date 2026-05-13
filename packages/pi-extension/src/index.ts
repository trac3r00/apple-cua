import { MacOSHostComputer } from "@macos-cua/core";
import { type ToolDefinition, type ToolResult, createTools } from "./tools/index.js";

export interface ExtensionContext {
	registerTool: (tool: ToolDefinition) => void;
	log: (message: string) => void;
}

export interface ExtensionConfig {
	display?: number;
}

let computer: MacOSHostComputer | null = null;

export function activate(context: ExtensionContext, config?: ExtensionConfig): void {
	computer = new MacOSHostComputer(config?.display !== undefined ? { display: config.display } : undefined);
	const tools = createTools(computer);

	for (const tool of tools) {
		context.registerTool(tool);
	}

	context.log("macos-cua extension activated");
}

export function deactivate(): void {
	if (computer) {
		computer.close();
		computer = null;
	}
}

export { createTools, type ToolDefinition, type ToolResult };

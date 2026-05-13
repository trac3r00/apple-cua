import path from "node:path";
import { fileURLToPath } from "node:url";

import { MacOSHostComputer } from "@macos-cua/core";

import type { ExtensionAPI } from "./pi/index.js";
import { registerAllTools } from "./tools/index.js";

interface ExtensionState {
	readonly computer: MacOSHostComputer;
}

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(sourceDirectory, "..");
const skillPath = path.resolve(packageRoot, "../../skills/macos-cua/SKILL.md");

let state: ExtensionState | undefined;

export default function macosCuaExtension(pi: ExtensionAPI): void {
	pi.on("resources_discover", async () => {
		return { skillPaths: [skillPath] };
	});

	pi.on("session_start", async () => {
		const computer = new MacOSHostComputer();
		state = { computer };
		registerAllTools(pi, { computer });
	});

	pi.on("session_shutdown", async () => {
		if (state === undefined) return;
		const { computer } = state;
		state = undefined;
		await computer.close();
	});
}

import { describe, expect, it, vi } from "vitest";

import macosCuaExtension from "./index.js";
import type { ExtensionAPI } from "./pi/index.js";

type EventHandler = (...parameters: ReadonlyArray<never>) => unknown;

interface MockPi extends ExtensionAPI {
	readonly handlers: Map<string, EventHandler>;
}

function createMockPi(): MockPi {
	const handlers = new Map<string, EventHandler>();
	const on = ((eventName: string, handler: EventHandler) => {
		handlers.set(eventName, handler as EventHandler);
	}) as ExtensionAPI["on"];
	return {
		handlers,
		on,
		registerTool() {},
		registerCommand() {},
		registerShortcut() {},
		registerFlag() {},
		getFlag() {
			return undefined;
		},
		registerMessageRenderer() {},
		sendMessage() {},
		sendUserMessage() {},
		appendEntry() {},
		setSessionName() {},
		getSessionName() {
			return undefined;
		},
		setLabel() {},
		exec: vi.fn<ExtensionAPI["exec"]>(),
		getActiveTools() {
			return [];
		},
		getAllTools() {
			return [];
		},
		setActiveTools() {},
		getCommands() {
			return [];
		},
		setModel: vi.fn<ExtensionAPI["setModel"]>().mockResolvedValue(false),
		getThinkingLevel: vi.fn<ExtensionAPI["getThinkingLevel"]>(),
		setThinkingLevel() {},
		registerProvider() {},
		unregisterProvider() {},
		events: {} as ExtensionAPI["events"],
	};
}

describe("#given macosCuaExtension #when imported #then default export is a named function", () => {
	it("is a function named macosCuaExtension", () => {
		expect(typeof macosCuaExtension).toBe("function");
		expect(macosCuaExtension.name).toBe("macosCuaExtension");
	});
});

describe("#given a pi API #when extension factory runs #then lifecycle handlers are registered", () => {
	it("registers resources_discover, session_start, and session_shutdown handlers", () => {
		const pi = createMockPi();
		const onSpy = vi.spyOn(pi, "on");

		macosCuaExtension(pi);

		expect(onSpy).toHaveBeenCalledWith("resources_discover", expect.any(Function));
		expect(onSpy).toHaveBeenCalledWith("session_start", expect.any(Function));
		expect(onSpy).toHaveBeenCalledWith("session_shutdown", expect.any(Function));
	});
});

describe("#given resources_discover #when invoked #then macOS skill path is returned", () => {
	it("returns the macos-cua skill path", async () => {
		const pi = createMockPi();
		macosCuaExtension(pi);
		const resourcesDiscover = pi.handlers.get("resources_discover");

		expect(resourcesDiscover).toBeDefined();
		const result = await resourcesDiscover?.();

		expect(result).toEqual({
			skillPaths: [expect.stringContaining("skills/macos-cua/SKILL.md")],
		});
	});
});

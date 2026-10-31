import { describe, expect, it } from "bun:test";
import { vi } from "@apple-cua/test-support";

const subprocess = vi.hoisted(() => ({
	spawn: vi.fn(() => {
		throw new Error("Importing the isolated entrypoint attempted to start a process.");
	}),
}));
vi.mock("node:child_process", () => subprocess);
vi.mock("koffi", () => {
	throw new Error("The isolated entrypoint imported native host bindings.");
});
vi.mock("node-mac-permissions", () => {
	throw new Error("The isolated entrypoint imported host permission APIs.");
});
vi.mock("get-windows", () => {
	throw new Error("The isolated entrypoint imported host window APIs.");
});

describe("#given the isolated public entrypoint #when imported #then no native host surface is loaded", () => {
	it("exports guest control and named ownership without starting a process", async () => {
		const isolated = await import("./isolated.js");
		expect(typeof isolated.TartGuestSupervisor.start).toBe("function");
		expect(typeof isolated.TartGuestTransport.open).toBe("function");
		const owner = { agentName: "Reader", parentAgentName: "OmO", sessionId: "fixture-session" };
		expect(isolated.withCursorIdentity("fixture-cursor", isolated.currentCursorOwner, owner)).toEqual(owner);
		expect(subprocess.spawn).not.toHaveBeenCalled();
	});
});

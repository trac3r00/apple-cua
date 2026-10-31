import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi, whenSettled } from "@apple-cua/test-support";
import type { GuestCommand } from "./tart-guest-transport.js";

vi.mock("node:child_process", () => ({
	spawn: () => {
		throw new Error("A transport unit test attempted to start a real process.");
	},
}));

const { withCursorIdentity } = await import("../computer/cursor-scope.js");
const { runInInputScope } = await import("../computer/input-scope.js");

const { TartGuestTransport } = await import("./tart-guest-transport.js");

const owner = { agentName: "Coordinator", sessionId: "owned-session" };
const registry = {
	...owner,
	backend: "tart",
	store: "guest-store",
	vmName: "apple-cua-fixture",
	runArguments: ["--no-graphics", "--no-audio", "--no-clipboard", "--no-usb-accessories", "--net-host"],
	sharedDirectories: [],
	attachedHostDisks: [],
};
let directory: string;

beforeEach(async () => {
	directory = await realpath(await mkdtemp(join(tmpdir(), "apple-cua-owned-guest-")));
	await writeFile(join(directory, "ownership.json"), JSON.stringify(registry));
});

afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

describe("#given an owned macOS guest #when commands run #then the host is never the command target", () => {
	it("pins executable, store and VM and sends script content through guest stdin", async () => {
		const commands: GuestCommand[] = [];
		const transport = await TartGuestTransport.open(directory, owner, async (command) => {
			commands.push(command);
			return Buffer.from(commands.length === 1 ? "VirtualMac2,1\n" : "guest-output");
		});
		const script = 'const text = "한글; $(not-a-shell-command)";';
		const output = await transport.execute(["/usr/bin/osascript", "-l", "JavaScript"], script);
		expect(output.toString()).toBe("guest-output");
		expect(commands[0]?.args).toEqual(["exec", "apple-cua-fixture", "/usr/sbin/sysctl", "-n", "hw.model"]);
		expect(commands[1]).toEqual({
			executable: join(directory, "tart.app/Contents/MacOS/tart"),
			args: ["exec", "-i", "apple-cua-fixture", "/usr/bin/osascript", "-l", "JavaScript"],
			environment: {
				HOME: expect.any(String),
				PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
				TART_HOME: join(directory, "guest-store"),
			},
			input: script,
		});
		transport.close();
	});

	it.each([
		{ sessionId: "other-session" },
		{ agentName: "Other" },
		{ vmName: "../../human-vm" },
		{ store: "../../.tart" },
		{ runArguments: ["--no-graphics"] },
		{ sharedDirectories: ["/Users/human"] },
		{ attachedHostDisks: ["/dev/disk0"] },
	])("refuses an ownership or sharing mismatch before execution: %j", async (change) => {
		await writeFile(join(directory, "ownership.json"), JSON.stringify({ ...registry, ...change }));
		const run = vi.fn(async () => Buffer.from("VirtualMac2,1"));
		await expect(TartGuestTransport.open(directory, owner, run)).rejects.toThrow(/registry/);
		expect(run).not.toHaveBeenCalled();
	});

	it("refuses a channel that reports physical Mac hardware", async () => {
		const run = vi.fn(async () => Buffer.from("MacBookPro18,3\n"));
		await expect(TartGuestTransport.open(directory, owner, run)).rejects.toThrow(/virtual machine/);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("allows a named child of this owner but rejects another session", async () => {
		const run = vi.fn(async () => Buffer.from("VirtualMac2,1\n"));
		const transport = await TartGuestTransport.open(directory, owner, run);
		const child = { agentName: "Reader", parentAgentName: "Coordinator", sessionId: owner.sessionId };
		await withCursorIdentity("child-cursor", () => transport.execute(["/usr/bin/true"]), child);
		const foreign = { ...child, sessionId: "another-session" };
		await expect(
			withCursorIdentity("foreign-cursor", () => transport.execute(["/usr/bin/true"]), foreign),
		).rejects.toThrow(/does not own/);
		expect(run).toHaveBeenCalledTimes(2);
		transport.close();
	});

	it("rejects the owned session under another agent name without dispatch", async () => {
		const run = vi.fn(async () => Buffer.from("VirtualMac2,1\n"));
		const transport = await TartGuestTransport.open(directory, owner, run);
		const impostor = { agentName: "Impostor", sessionId: owner.sessionId };
		await expect(
			withCursorIdentity("impostor-cursor", () => transport.execute(["/usr/bin/true"]), impostor),
		).rejects.toThrow(/does not own/);
		expect(run).toHaveBeenCalledTimes(1);
		transport.close();
	});

	it("checks cancellation when a queued guest command reaches dispatch", async () => {
		let releaseFirst: () => void = () => {
			throw new Error("First command gate was not initialized.");
		};
		let enteredFirst: () => void = () => {
			throw new Error("First command signal was not initialized.");
		};
		const gate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const entered = new Promise<void>((resolve) => {
			enteredFirst = resolve;
		});
		const run = vi.fn(async (command: GuestCommand) => {
			if (command.args.includes("/bin/first")) {
				enteredFirst();
				await gate;
			}
			return Buffer.from("VirtualMac2,1\n");
		});
		const transport = await TartGuestTransport.open(directory, owner, run);
		const first = transport.execute(["/bin/first"]);
		await entered;
		let stopped = false;
		const scope = { interruption: () => (stopped ? "test stop" : undefined) };
		const second = runInInputScope(scope, () => transport.execute(["/bin/second"]));
		stopped = true;
		const rejected = whenSettled(second, (settled) => expect(settled).rejects.toThrow("test stop"));
		releaseFirst();
		await first;
		await rejected;
		expect(run).toHaveBeenCalledTimes(2);
		transport.close();
	});

	it("rejects commands after close without dispatch", async () => {
		const run = vi.fn(async () => Buffer.from("VirtualMac2,1\n"));
		const transport = await TartGuestTransport.open(directory, owner, run);
		transport.close();
		await expect(transport.execute(["/usr/bin/true"])).rejects.toThrow(/closed/);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("captures a guest PNG through the same owned command route", async () => {
		const png = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3l8AAAAASUVORK5CYII=",
			"base64",
		);
		const commands: GuestCommand[] = [];
		const transport = await TartGuestTransport.open(directory, owner, async (command) => {
			commands.push(command);
			return Buffer.from(commands.length === 1 ? "VirtualMac2,1\n" : png.toString("base64"));
		});
		try {
			expect(await transport.screenshot()).toEqual({
				data: png,
				mimeType: "image/png",
				width: 1,
				height: 1,
			});
			expect(commands[1]?.args.slice(0, 4)).toEqual(["exec", "apple-cua-fixture", "/bin/sh", "-c"]);
			expect(commands[1]?.args[4]).toContain("trap 'rm -rf \"$d\"' EXIT");
		} finally {
			transport.close();
		}
	});
});

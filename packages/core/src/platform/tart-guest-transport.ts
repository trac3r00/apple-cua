import { spawn } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type CursorOwner, currentCursorOwner } from "../computer/cursor-scope.js";
import { assertInputMayContinue, currentInputScope } from "../computer/input-scope.js";
import type { ScreenshotResult } from "../computer/interface.js";
import { parsePngDimensions } from "./image-format.js";

export interface GuestCommand {
	readonly executable: string;
	readonly args: readonly string[];
	readonly environment: NodeJS.ProcessEnv;
	readonly input?: string;
}

export type GuestCommandRunner = (command: GuestCommand) => Promise<Buffer>;

const REQUIRED_FLAGS = ["--no-graphics", "--no-audio", "--no-clipboard", "--no-usb-accessories", "--net-host"];

export interface TartGuestTarget {
	readonly executable: string;
	readonly store: string;
	readonly vm: string;
	readonly runArguments: readonly string[];
}

export async function readTartGuestTarget(directory: string, expectedOwner: CursorOwner): Promise<TartGuestTarget> {
	const root = await realpath(directory);
	const record: unknown = JSON.parse(await readFile(join(root, "ownership.json"), "utf8"));
	if (
		typeof record !== "object" ||
		record === null ||
		!("backend" in record) ||
		record.backend !== "tart" ||
		!("agentName" in record) ||
		record.agentName !== expectedOwner.agentName ||
		!("sessionId" in record) ||
		record.sessionId !== expectedOwner.sessionId ||
		!("store" in record) ||
		record.store !== "guest-store" ||
		!("vmName" in record) ||
		typeof record.vmName !== "string" ||
		!/^apple-cua-[a-z0-9-]+$/.test(record.vmName) ||
		!("runArguments" in record) ||
		!Array.isArray(record.runArguments) ||
		record.runArguments.length !== REQUIRED_FLAGS.length ||
		!record.runArguments.every((flag: unknown, index: number) => flag === REQUIRED_FLAGS[index]) ||
		!("sharedDirectories" in record) ||
		!Array.isArray(record.sharedDirectories) ||
		record.sharedDirectories.length !== 0 ||
		!("attachedHostDisks" in record) ||
		!Array.isArray(record.attachedHostDisks) ||
		record.attachedHostDisks.length !== 0
	) {
		throw new Error("The isolated desktop registry does not match this owner or its isolation contract.");
	}
	return {
		executable: join(root, "tart.app/Contents/MacOS/tart"),
		store: join(root, "guest-store"),
		vm: record.vmName,
		runArguments: [...REQUIRED_FLAGS],
	};
}

/**
 * Transport for an explicitly provisioned desktop registry, not an arbitrary
 * running Mac or user VM. Every command travels through Tart's guest channel.
 * Provisioning and runtime supervision own the registry and the VM lifecycle.
 */
export class TartGuestTransport {
	private closed = false;
	private tail: Promise<unknown> = Promise.resolve();

	private constructor(
		readonly owner: CursorOwner,
		private readonly executable: string,
		private readonly store: string,
		private readonly vm: string,
		private readonly run: GuestCommandRunner,
	) {
		Object.freeze(this.owner);
	}

	static async open(
		directory: string,
		expectedOwner: CursorOwner,
		run?: GuestCommandRunner,
		signal?: AbortSignal,
	): Promise<TartGuestTransport> {
		const target = await readTartGuestTarget(directory, expectedOwner);
		let starting = true;
		const runner = run ?? ((command: GuestCommand) => runGuestCommand(command, starting ? 90_000 : 30_000, signal));
		const transport = new TartGuestTransport(
			{ ...expectedOwner },
			target.executable,
			target.store,
			target.vm,
			runner,
		);
		const model = (await transport.execute(["/usr/sbin/sysctl", "-n", "hw.model"])).toString("utf8").trim();
		starting = false;
		if (!/^VirtualMac\d+,\d+$/.test(model)) {
			transport.close();
			throw new Error("The guest channel did not identify an Apple virtual machine.");
		}
		return transport;
	}

	execute(args: readonly string[], input?: string): Promise<Buffer> {
		if (args.length === 0 || !args[0]?.startsWith("/") || args.some((arg) => arg.includes("\0"))) {
			return Promise.reject(new Error("A guest command requires an absolute executable and valid arguments."));
		}
		const caller = currentCursorOwner() ?? this.owner;
		const scope = currentInputScope();
		if (
			caller.sessionId !== this.owner.sessionId ||
			(caller.agentName !== this.owner.agentName && caller.parentAgentName !== this.owner.agentName)
		) {
			return Promise.reject(new Error("This agent does not own the isolated desktop session."));
		}
		const command: GuestCommand = {
			executable: this.executable,
			args: input === undefined ? ["exec", this.vm, ...args] : ["exec", "-i", this.vm, ...args],
			environment: {
				HOME: homedir(),
				PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
				TART_HOME: this.store,
			},
			...(input === undefined ? {} : { input }),
		};
		const result = this.tail.then(async () => {
			if (this.closed) throw new Error("The isolated desktop transport is closed.");
			assertInputMayContinue(scope);
			return this.run(command);
		});
		this.tail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	close(): void {
		this.closed = true;
	}

	async screenshot(): Promise<ScreenshotResult> {
		const script = `set -eu
d=$(mktemp -d /tmp/apple-cua-guest-shot.XXXXXX)
trap 'rm -rf "$d"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
/usr/sbin/screencapture -x -t png "$d/frame.png"
/usr/bin/base64 -i "$d/frame.png"`;
		const encoded = await this.execute(["/bin/sh", "-c", script]);
		const data = Buffer.from(encoded.toString("ascii"), "base64");
		const { width, height } = parsePngDimensions(data);
		if (width === 0 || height === 0) throw new Error("The isolated guest returned an empty display.");
		return { data, mimeType: "image/png", width, height };
	}

	matches(target: TartGuestTarget): boolean {
		return this.executable === target.executable && this.store === target.store && this.vm === target.vm;
	}
}

function runGuestCommand(command: GuestCommand, timeoutMilliseconds = 30_000, signal?: AbortSignal): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const timeout = AbortSignal.timeout(timeoutMilliseconds);
		const child = spawn(command.executable, command.args, {
			env: command.environment,
			stdio: ["pipe", "pipe", "pipe"],
			signal: signal === undefined ? timeout : AbortSignal.any([timeout, signal]),
		});
		const chunks: Buffer[] = [];
		let bytes = 0;
		let errorText = "";
		child.stdout.on("data", (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes > 32 * 1024 * 1024) {
				child.kill();
				reject(new Error("Guest command output exceeded 32 MiB."));
				return;
			}
			chunks.push(chunk);
		});
		child.stderr.on("data", (chunk: Buffer) => {
			errorText = (errorText + chunk.toString("utf8")).slice(0, 2048);
		});
		child.once("error", reject);
		child.once("close", (code) => {
			if (code !== 0) {
				reject(new Error(`Guest command failed (${String(code)}): ${errorText}`));
			} else {
				resolve(Buffer.concat(chunks));
			}
		});
		child.stdin.on("error", reject);
		child.stdin.end(command.input);
	});
}

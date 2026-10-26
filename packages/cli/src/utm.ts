import { writeFileSync } from "node:fs";
import { UTM } from "@apple-cua/core";
import { type Command, InvalidArgumentError } from "commander";

type RegisterUtmOptions = {
	readonly isJsonOutput: () => boolean;
};

type MouseButton = "left" | "right" | "middle";
type ClickOptions = {
	readonly x: number;
	readonly y: number;
	readonly button?: MouseButton;
	readonly monitor?: number;
	readonly imageCoordinates?: boolean;
};

export function registerUtmCommands(program: Command, options: RegisterUtmOptions): void {
	const utm = program
		.command("utm")
		.description("Control UTM virtual machines")
		.option("--app <path>", "UTM app path");
	const createUtm = (): UTM => {
		const { app } = utm.opts<{ app?: string }>();
		return new UTM(app === undefined ? {} : { appPath: app });
	};
	const writeOutput = (value: unknown, humanValue: string): void => {
		process.stdout.write(options.isJsonOutput() ? `${JSON.stringify(value)}\n` : `${humanValue}\n`);
	};

	utm.command("list")
		.description("List virtual machines")
		.action(async () => {
			const machines = await createUtm().list();
			writeOutput(machines, machines.map((vm) => `${vm.id}\t${vm.name}\t${vm.status}\t${vm.backend}`).join("\n"));
		});

	for (const action of ["start", "suspend", "stop"] as const) {
		utm.command(action)
			.description(action === "stop" ? "Request a graceful virtual machine shutdown" : `${action} a virtual machine`)
			.argument("<vm>", "virtual machine ID or name")
			.action(async (vm: string) => {
				await createUtm()[action](vm);
				writeOutput({ ok: true, action, args: { vm } }, `${action} requested for ${vm}`);
			});
	}

	utm.command("type")
		.description("Type text into a virtual machine")
		.argument("<vm>", "virtual machine ID or name")
		.argument("<text>", "text to type")
		.action(async (vm: string, text: string) => {
			await createUtm().type(vm, text);
			writeOutput({ ok: true, action: "type", args: { vm, text } }, `Typed ${text.length} characters into ${vm}`);
		});

	utm.command("key")
		.description("Press a key combination in a virtual machine")
		.argument("<vm>", "virtual machine ID or name")
		.argument("<combo>", "key combination")
		.action(async (vm: string, combo: string) => {
			await createUtm().key(vm, combo);
			writeOutput({ ok: true, action: "key", args: { vm, combo } }, `Pressed ${combo} in ${vm}`);
		});

	utm.command("click")
		.description("Click a point in a virtual machine")
		.argument("<vm>", "virtual machine ID or name")
		.requiredOption("-x, --x <number>", "non-negative integer x coordinate", parseCoordinate)
		.requiredOption("-y, --y <number>", "non-negative integer y coordinate", parseCoordinate)
		.option("--button <button>", "mouse button: left, right, or middle", parseMouseButton)
		.option("--monitor <number>", "positive monitor number", parseMonitor)
		.option(
			"--image-coordinates",
			"map screenshot pixels using a fresh current observation; does not validate an earlier screenshot",
		)
		.action(async (vm: string, flags: ClickOptions) => {
			const { x, y, imageCoordinates, ...clickOptions } = flags;
			if (imageCoordinates && (clickOptions.button !== undefined || clickOptions.monitor !== undefined)) {
				throw new InvalidArgumentError("--image-coordinates cannot be combined with --button or --monitor");
			}
			const client = createUtm();
			if (imageCoordinates) {
				const observation = await client.observe(vm);
				await client.clickObserved(vm, { x, y }, observation);
			} else {
				await client.click(vm, { x, y }, clickOptions);
			}
			writeOutput({ ok: true, action: "click", args: { vm, ...flags } }, `Clicked ${x},${y} in ${vm}`);
		});

	utm.command("move")
		.description("Move the virtual cursor in guest pixels")
		.argument("<vm>", "virtual machine ID or name")
		.requiredOption("-x, --x <number>", "non-negative integer guest x coordinate", parseCoordinate)
		.requiredOption("-y, --y <number>", "non-negative integer guest y coordinate", parseCoordinate)
		.action(async (vm: string, flags: { readonly x: number; readonly y: number }) => {
			await createUtm().move(vm, flags);
			writeOutput({ ok: true, action: "move", args: { vm, ...flags } }, `Moved to ${flags.x},${flags.y} in ${vm}`);
		});

	utm.command("observe")
		.description("Observe a virtual machine with OCR boxes in guest pixels")
		.argument("<vm>", "virtual machine ID or name")
		.option("-o, --output <path>", "save the observed screenshot")
		.action(async (vm: string, flags: { readonly output?: string }) => {
			const { image, ...observation } = await createUtm().observe(vm);
			if (flags.output !== undefined) writeFileSync(flags.output, image.data);
			const { data: _data, ...imageMetadata } = image;
			const metadata = {
				ok: true,
				action: "observe",
				args: { vm, ...flags },
				image: imageMetadata,
				...observation,
				...(flags.output === undefined ? {} : { output: flags.output }),
			};
			writeOutput(metadata, JSON.stringify(metadata, null, 2));
		});

	utm.command("click-text")
		.description("Click the center of a unique case-insensitive OCR text match")
		.argument("<vm>", "virtual machine ID or name")
		.argument("<query>", "text to match, preferring an exact match")
		.action(async (vm: string, query: string) => {
			const normalized = query.trim().toLowerCase();
			if (normalized.length === 0) throw new InvalidArgumentError("text query must not be empty");
			const client = createUtm();
			const observation = await client.observe(vm);
			const exact = observation.texts.filter((entry) => entry.text.toLowerCase() === normalized);
			const matches =
				exact.length > 0
					? exact
					: observation.texts.filter((entry) => entry.text.toLowerCase().includes(normalized));
			const match = matches[0];
			if (match === undefined) throw new InvalidArgumentError(`No OCR text matches ${JSON.stringify(query)}`);
			if (matches.length !== 1) {
				throw new InvalidArgumentError(
					`Ambiguous OCR text query ${JSON.stringify(query)}: ${matches.length} matches`,
				);
			}
			const fresh = await client.observe(vm);
			const a = observation.displayRect;
			const b = fresh.displayRect;
			if (
				fresh.windowId !== observation.windowId ||
				fresh.guestSize.width !== observation.guestSize.width ||
				fresh.guestSize.height !== observation.guestSize.height ||
				a.x !== b.x ||
				a.y !== b.y ||
				a.width !== b.width ||
				a.height !== b.height
			) {
				throw new InvalidArgumentError("UTM window or display geometry changed; observe again");
			}
			const currentTargets = fresh.texts.filter(
				(entry) =>
					entry.text === match.text &&
					Math.abs(entry.box.x - match.box.x) <= 2 &&
					Math.abs(entry.box.y - match.box.y) <= 2 &&
					Math.abs(entry.box.width - match.box.width) <= 2 &&
					Math.abs(entry.box.height - match.box.height) <= 2,
			);
			if (currentTargets.length !== 1) {
				throw new InvalidArgumentError("The observed OCR text changed, moved or disappeared; observe again");
			}
			const point = {
				x: Math.floor(match.box.x + match.box.width / 2),
				y: Math.floor(match.box.y + match.box.height / 2),
			};
			await client.click(vm, point);
			writeOutput(
				{ ok: true, action: "click-text", args: { vm, query }, text: match.text, ...point },
				`Clicked ${JSON.stringify(match.text)} at ${point.x},${point.y} in ${vm}`,
			);
		});

	utm.command("screenshot")
		.description("Save a virtual machine screenshot as a PNG")
		.argument("<vm>", "virtual machine ID or name")
		.requiredOption("-o, --output <path>", "output file path")
		.action(async (vm: string, flags: { readonly output: string }) => {
			const image = await createUtm().screenshot(vm);
			writeFileSync(flags.output, image.data);
			writeOutput(
				{
					ok: true,
					action: "screenshot",
					args: { vm, output: flags.output },
					output: flags.output,
					mimeType: image.mimeType,
					width: image.width,
					height: image.height,
				},
				`Screenshot saved to ${flags.output} (${image.width}x${image.height})`,
			);
		});
}

function parseCoordinate(value: string): number {
	const number = Number(value);
	if (value.trim() === "" || !Number.isSafeInteger(number) || number < 0) {
		throw new InvalidArgumentError("coordinate must be a finite non-negative integer");
	}
	return number;
}

function parseMonitor(value: string): number {
	const number = Number(value);
	if (value.trim() === "" || !Number.isSafeInteger(number) || number <= 0) {
		throw new InvalidArgumentError("monitor must be a positive integer");
	}
	return number;
}

function parseMouseButton(value: string): MouseButton {
	if (value === "left" || value === "right" || value === "middle") return value;
	throw new InvalidArgumentError("button must be left, right, or middle");
}

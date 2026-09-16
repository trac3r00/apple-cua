import { clickPoint, parseElementIndex, pressElement, pressKeySequence, withTargetedApp } from "@macos-cua/core";
import type { ComputerInterface, InputObservation, KeySequenceEntry, KeySequenceOptions, Point } from "@macos-cua/core";
import { observedPointToScreen, validateElement, validatePoint } from "./guarded-session.js";
import type { ActionDispatch } from "./tool-result.js";
import type { ClickInput, DragInput, PressKeysInput, SelectTextInput } from "./tool-schemas.js";

export function validateClick(input: ClickInput, observation: InputObservation): void {
	if (input.element_index !== undefined) {
		validateElement(observation, parseElementIndex(input.element_index));
		return;
	}
	validatePoint(observation, clickPointInput(input.x, input.y));
}

export async function click(
	computer: ComputerInterface,
	targetPid: number,
	observation: InputObservation,
	input: ClickInput,
): Promise<ActionDispatch> {
	const pressCount = Math.max(1, Math.trunc(input.click_count ?? 1));
	if (input.element_index !== undefined) {
		const index = parseElementIndex(input.element_index);
		for (let pressIndex = 0; pressIndex < pressCount; pressIndex += 1) {
			await pressElement(computer, targetPid, index);
		}
		return { route: "accessibility", delivery: "background" };
	}
	const point = observedPointToScreen(observation, clickPointInput(input.x, input.y));
	if ((input.mouse_button ?? "left") === "left") {
		let pressedAll = true;
		for (let pressIndex = 0; pressIndex < pressCount; pressIndex += 1) {
			if (!(await computer.pressAtPosition(targetPid, point))) {
				pressedAll = false;
				break;
			}
		}
		if (pressedAll) {
			return { route: "synthetic_events", delivery: "background" };
		}
	}
	await withTargetedApp(computer, targetPid, async () => {
		await clickPoint(computer, point, input.mouse_button ?? "left", pressCount);
	});
	return { route: "synthetic_events", delivery: "background" };
}

export function validateDrag(input: DragInput, observation: InputObservation): void {
	validatePoint(observation, { x: input.from_x, y: input.from_y });
	validatePoint(observation, { x: input.to_x, y: input.to_y });
}

export async function drag(
	computer: ComputerInterface,
	targetPid: number,
	observation: InputObservation,
	input: DragInput,
): Promise<ActionDispatch> {
	const from = observedPointToScreen(observation, { x: input.from_x, y: input.from_y });
	const to = observedPointToScreen(observation, { x: input.to_x, y: input.to_y });
	await withTargetedApp(computer, targetPid, async () => {
		await computer.drag({ from, to });
	});
	return { route: "synthetic_events", delivery: "background" };
}

export async function typeText(computer: ComputerInterface, targetPid: number, text: string): Promise<ActionDispatch> {
	if (await computer.typeIntoFocused(targetPid, text)) {
		return { route: "accessibility", delivery: "background" };
	}
	await withTargetedApp(computer, targetPid, async () => {
		await computer.type(text);
	});
	return { route: "synthetic_events", delivery: "background" };
}

export async function selectText(
	computer: ComputerInterface,
	targetPid: number,
	elementIndex: number,
	input: SelectTextInput,
): Promise<ActionDispatch> {
	await computer.selectText(targetPid, elementIndex, {
		selection: input.selection ?? "text",
		...(input.text !== undefined ? { text: input.text } : {}),
		...(input.prefix !== undefined ? { prefix: input.prefix } : {}),
		...(input.suffix !== undefined ? { suffix: input.suffix } : {}),
	});
	return { route: "accessibility", delivery: "background" };
}

export async function pressKeys(
	computer: ComputerInterface,
	targetPid: number,
	input: PressKeysInput,
): Promise<ActionDispatch> {
	await withTargetedApp(computer, targetPid, async () => {
		await pressKeySequence(computer, input.keys.map(keySequenceEntryFromInput), keySequenceOptions(input));
	});
	return { route: "synthetic_events", delivery: "background" };
}

function clickPointInput(x: number | undefined, y: number | undefined): Point {
	if (x === undefined || y === undefined) {
		throw new Error("click requires either element_index or x and y coordinates");
	}
	return { x, y };
}

function keySequenceEntryFromInput(input: PressKeysInput["keys"][number]): KeySequenceEntry {
	if (typeof input === "string") {
		return { key: input };
	}
	return input.hold_seconds === undefined ? { key: input.key } : { key: input.key, holdSeconds: input.hold_seconds };
}

function keySequenceOptions(input: PressKeysInput): KeySequenceOptions | undefined {
	const holdSeconds = input.hold_seconds;
	const intervalSeconds = input.interval_seconds;
	if (holdSeconds !== undefined && intervalSeconds !== undefined) {
		return { holdSeconds, intervalSeconds };
	}
	if (holdSeconds !== undefined) {
		return { holdSeconds };
	}
	return intervalSeconds === undefined ? undefined : { intervalSeconds };
}

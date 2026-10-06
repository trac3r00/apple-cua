import {
	AX_PRESS_ACTION,
	clickPoint,
	normalizeModifiers,
	parseElementIndex,
	pressElement,
	pressKeySequence,
	scrollElement,
	withTargetedApp,
} from "@apple-cua/core";
import type {
	ComputerInterface,
	ComputerUseMouseButton,
	InputObservation,
	KeyModifierName,
	KeySequenceEntry,
	KeySequenceOptions,
	Point,
	ScrollOptions,
} from "@apple-cua/core";
import { observedPointToScreen, validateElement, validatePoint } from "./guarded-session.js";
import type { ActionDelivery, ActionDispatch } from "./tool-result.js";
import type { ClickActionInput, DragActionInput, PressKeysActionInput, SelectTextActionInput } from "./tool-schemas.js";

export function validateClick(input: ClickActionInput, observation: InputObservation): void {
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
	input: ClickActionInput,
): Promise<ActionDispatch> {
	const pressCount = Math.max(1, Math.trunc(input.click_count ?? 1));
	const button = input.mouse_button ?? "left";
	const modifiers = normalizeModifiers(input.modifiers);
	if (input.element_index !== undefined) {
		const index = parseElementIndex(input.element_index);
		if (modifiers.length > 0 || button !== "left") {
			// AXPress is a plain left press: it carries no modifiers and cannot be a right or middle click (pressing
			// a Delete button instead of opening its context menu). The element's centre goes through the pointer route.
			const gesture = button === "left" ? "click with modifiers" : `${button}-click`;
			const centre = await elementCentre(computer, targetPid, index, gesture);
			return await clickScreenPoint(computer, targetPid, centre, button, pressCount, modifiers);
		}
		try {
			await pressElement(computer, targetPid, index);
		} catch (error: unknown) {
			const centre = await unsupportedPressFallbackPoint(computer, targetPid, index, error);
			const dispatch = await clickScreenPoint(computer, targetPid, centre, button, pressCount, modifiers);
			return { ...dispatch, fallback: { from: "accessibility", reason: errorMessage(error) } };
		}
		for (let pressIndex = 1; pressIndex < pressCount; pressIndex += 1) {
			await pressElement(computer, targetPid, index);
		}
		return { route: "accessibility", delivery: "background" };
	}
	const point = observedPointToScreen(observation, clickPointInput(input.x, input.y));
	return await clickScreenPoint(computer, targetPid, point, button, pressCount, modifiers);
}

/**
 * The on-screen centre of an observed element, for gestures accessibility actions cannot perform
 * (they carry no modifier keys and no wheel). Refuses when the element has no frame to aim at.
 */
async function elementCentre(
	computer: ComputerInterface,
	targetPid: number,
	index: number,
	gesture: string,
): Promise<Point> {
	const frame = computer.elementFrame === undefined ? undefined : await computer.elementFrame(targetPid, index);
	if (frame === undefined || frame.width <= 0 || frame.height <= 0) {
		throw new Error(`cannot ${gesture}: element ${index} has no on-screen frame to aim the pointer at`);
	}
	return { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
}

/** Accessibility refusals of the press itself (not identity or safety refusals) can fall back to a click. */
const AX_PRESS_FAILURE = /failed with AXError -?\d+/;

/**
 * The next rung when a control rejects AXPress: its on-screen centre, so the same element is
 * clicked through the pointer route instead of the action failing. Anything that is not an
 * accessibility refusal of the press — a recycled control, an unobserved id — is rethrown, because
 * falling back there would click something the caller never observed.
 */
async function unsupportedPressFallbackPoint(
	computer: ComputerInterface,
	targetPid: number,
	index: number,
	error: unknown,
): Promise<Point> {
	if (!AX_PRESS_FAILURE.test(errorMessage(error)) || computer.elementFrame === undefined) {
		throw error;
	}
	const frame = await computer.elementFrame(targetPid, index);
	if (frame === undefined || frame.width <= 0 || frame.height <= 0) {
		throw error;
	}
	return { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
}

async function clickScreenPoint(
	computer: ComputerInterface,
	targetPid: number,
	point: Point,
	button: ComputerUseMouseButton,
	pressCount: number,
	modifiers: ReadonlyArray<KeyModifierName>,
): Promise<ActionDispatch> {
	// An accessibility press at the point cannot carry modifiers, so a modified click is always a pointer click.
	if (button === "left" && modifiers.length === 0) {
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
		await clickPoint(computer, point, button, pressCount, modifiers);
	});
	return { route: "synthetic_events", delivery: syntheticDelivery(computer) };
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** One control a caller described instead of naming by id, with the traits the route decision needs. */
export interface ResolvedTargetClick {
	readonly elementIndex: number;
	readonly actions: readonly string[];
	readonly frame: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
	readonly press?: "auto" | "accessibility" | "pointer" | undefined;
	readonly hoverFirst?: boolean | undefined;
	readonly clickCount?: number | undefined;
	readonly mouseButton?: "left" | "right" | "middle" | undefined;
}

/**
 * Click a control the caller resolved by description rather than by id: hover to it first when
 * asked, then press it through its accessibility action when the control advertises one and the
 * caller did not ask for the pointer route, or click its centre otherwise. Coordinates are only
 * resolved on the routes that need them, so an offscreen but pressable control still works.
 */
export async function clickResolvedTarget(
	computer: ComputerInterface,
	targetPid: number,
	observation: InputObservation,
	target: ResolvedTargetClick,
): Promise<ActionDispatch> {
	const pressCount = Math.max(1, Math.trunc(target.clickCount ?? 1));
	const button: ComputerUseMouseButton = target.mouseButton ?? "left";
	const pointerRoute = target.press === "pointer" || button !== "left";
	const accessibilityRoute =
		target.press === "accessibility" || (!pointerRoute && target.actions.includes(AX_PRESS_ACTION));
	const centre = {
		x: target.frame.x + target.frame.width / 2,
		y: target.frame.y + target.frame.height / 2,
	};
	if (accessibilityRoute) {
		if (target.hoverFirst === true) {
			await computer.move(observedPointToScreen(observation, centre));
		}
		for (let pressIndex = 0; pressIndex < pressCount; pressIndex += 1) {
			await pressElement(computer, targetPid, target.elementIndex);
		}
		return { route: "accessibility", delivery: "background" };
	}
	const centreScreen = observedPointToScreen(observation, centre);
	if (target.hoverFirst === true) {
		await computer.move(centreScreen);
	}
	if (button === "left") {
		let pressedAll = true;
		for (let pressIndex = 0; pressIndex < pressCount; pressIndex += 1) {
			if (!(await computer.pressAtPosition(targetPid, centreScreen))) {
				pressedAll = false;
				break;
			}
		}
		if (pressedAll) {
			return { route: "synthetic_events", delivery: "background" };
		}
	}
	await withTargetedApp(computer, targetPid, async () => {
		await clickPoint(computer, centreScreen, button, pressCount);
	});
	return { route: "synthetic_events", delivery: syntheticDelivery(computer) };
}

export function validateDrag(input: DragActionInput, observation: InputObservation): void {
	validatePoint(observation, { x: input.from_x, y: input.from_y });
	validatePoint(observation, { x: input.to_x, y: input.to_y });
}

export async function drag(
	computer: ComputerInterface,
	targetPid: number,
	observation: InputObservation,
	input: DragActionInput,
): Promise<ActionDispatch> {
	const from = observedPointToScreen(observation, { x: input.from_x, y: input.from_y });
	const to = observedPointToScreen(observation, { x: input.to_x, y: input.to_y });
	const modifiers = normalizeModifiers(input.modifiers);
	await withTargetedApp(computer, targetPid, async () => {
		await computer.drag(modifiers.length === 0 ? { from, to } : { from, to, modifiers });
	});
	return { route: "synthetic_events", delivery: syntheticDelivery(computer) };
}

/**
 * Why a scroll with modifier keys is refused. Verified live against a Finder list in the background: wheel
 * events posted to the app's process with modifier flags do not scroll it, yet the post itself reports
 * success, so sending them would claim a scroll that never happened.
 */
const SCROLL_MODIFIERS_REFUSAL =
	"scroll with modifiers is refused: wheel events with modifier keys do not scroll a background app's view (they are accepted and then ignored), so nothing was sent. Scroll without modifiers (a page-scroll accessibility action), or use `find` on a target to scroll until it is shown.";

/**
 * Scroll an observed element by pages through its page-scroll accessibility action, which works while the
 * app is in the background. Modifier keys cannot ride on an accessibility action, and the wheel route that
 * could carry them does not scroll a background app, so a scroll with modifiers is refused before anything
 * is dispatched.
 */
export async function scroll(
	computer: ComputerInterface,
	targetPid: number,
	elementIndex: number,
	input: {
		readonly direction: ScrollOptions["direction"];
		readonly pages?: number | undefined;
		readonly modifiers?: ReadonlyArray<KeyModifierName> | undefined;
	},
): Promise<ActionDispatch> {
	if (normalizeModifiers(input.modifiers).length > 0) {
		throw new Error(SCROLL_MODIFIERS_REFUSAL);
	}
	await scrollElement(computer, targetPid, elementIndex, input.direction, input.pages ?? 1);
	return { route: "accessibility", delivery: "background" };
}

export async function typeText(computer: ComputerInterface, targetPid: number, text: string): Promise<ActionDispatch> {
	if (await computer.typeIntoFocused(targetPid, text)) {
		return { route: "accessibility", delivery: "background" };
	}
	await withTargetedApp(computer, targetPid, async () => {
		await computer.type(text);
	});
	return { route: "synthetic_events", delivery: syntheticDelivery(computer) };
}

export async function selectText(
	computer: ComputerInterface,
	targetPid: number,
	elementIndex: number,
	input: SelectTextActionInput,
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
	input: PressKeysActionInput,
): Promise<ActionDispatch> {
	await withTargetedApp(computer, targetPid, async () => {
		await pressKeySequence(computer, input.keys.map(keySequenceEntryFromInput), keySequenceOptions(input));
	});
	return { route: "synthetic_events", delivery: syntheticDelivery(computer) };
}

/**
 * Delivery label for a synthetic-events action that travels through the input controller's
 * target routing: attended delivery leases the foreground for it, background delivery posts to
 * the target process without touching the frontmost app. Which route ran is decided above;
 * this only names how the input travelled.
 */
function syntheticDelivery(computer: ComputerInterface): ActionDelivery {
	return computer.delivery === "attended" ? "foreground" : "background";
}

function clickPointInput(x: number | undefined, y: number | undefined): Point {
	if (x === undefined || y === undefined) {
		throw new Error("click requires either element_index or x and y coordinates");
	}
	return { x, y };
}

function keySequenceEntryFromInput(input: PressKeysActionInput["keys"][number]): KeySequenceEntry {
	if (typeof input === "string") {
		return { key: input };
	}
	return input.hold_seconds === undefined ? { key: input.key } : { key: input.key, holdSeconds: input.hold_seconds };
}

function keySequenceOptions(input: PressKeysActionInput): KeySequenceOptions | undefined {
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

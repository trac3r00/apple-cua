import { parseElementIndex, scrollElement } from "@apple-cua/core";
import type { GuardedComputerInterface, InputObservation } from "@apple-cua/core";
import type { RunStepDriver } from "./guarded-session.js";
import { validateElement } from "./guarded-session.js";
import { click, drag, pressKeys, selectText, typeText, validateClick, validateDrag } from "./mutation-actions.js";
import { dispatchPowerStep } from "./power-tools.js";
import type { StepDispatch } from "./tool-result.js";
import type { RunStep } from "./tool-schemas.js";

export function stepElementIndex(step: RunStep): number | undefined {
	return "element_index" in step && step.element_index !== undefined
		? parseElementIndex(step.element_index)
		: undefined;
}

export function validateStep(step: RunStep, observation: InputObservation): void {
	switch (step.type) {
		case "click":
			validateClick(step, observation);
			return;
		case "drag":
			validateDrag(step, observation);
			return;
		case "perform_secondary_action":
		case "set_value":
		case "select_text":
		case "scroll": {
			const index = stepElementIndex(step);
			if (index !== undefined) {
				validateElement(observation, index);
			}
			return;
		}
		case "clipboard_write":
			if ([step.text, step.image_path, step.file_path].filter((value) => value !== undefined).length !== 1) {
				throw new Error("clipboard_write requires exactly one of text, image_path, or file_path");
			}
			return;
		default:
			return;
	}
}

export async function dispatchStep(
	computer: GuardedComputerInterface,
	step: RunStep,
	targetPid: number,
	observation: InputObservation,
): Promise<StepDispatch> {
	const power = await dispatchPowerStep(computer, step, targetPid, observation);
	if (power !== undefined) {
		return power;
	}
	switch (step.type) {
		case "click":
			return await click(computer, targetPid, observation, step);
		case "perform_secondary_action":
			await computer.performAction(targetPid, parseElementIndex(step.element_index), step.action);
			return { route: "accessibility", delivery: "background" };
		case "set_value":
			await computer.setValue(targetPid, parseElementIndex(step.element_index), step.value);
			return { route: "accessibility", delivery: "background" };
		case "select_text":
			return await selectText(computer, targetPid, parseElementIndex(step.element_index), step);
		case "drag":
			return await drag(computer, targetPid, observation, step);
		case "scroll":
			await scrollElement(
				computer,
				targetPid,
				parseElementIndex(step.element_index),
				step.direction,
				step.pages ?? 1,
			);
			return { route: "accessibility", delivery: "background" };
		case "type_text":
			return await typeText(computer, targetPid, step.text);
		case "press_keys":
			return await pressKeys(computer, targetPid, step);
		default:
			throw new Error(`run_steps does not support step type ${step.type}`);
	}
}

export function createRunStepDriver(computer: GuardedComputerInterface): RunStepDriver {
	return {
		elementIndex: stepElementIndex,
		validate: validateStep,
		dispatch: async (step, targetPid, observation) => await dispatchStep(computer, step, targetPid, observation),
	};
}

import type { MirroringObservation } from "@apple-cua/core";
import { MAX_TARGETS_PER_OPERATION, SPARSE_TARGET_COUNT } from "./questions.js";
import type { ActionSpace, TableElement, Target } from "./types.js";

/**
 * The phone has no accessibility tree: the only thing it publishes is what the OCR read off the
 * screen, as strings with a tap-ready centre. That is already an indexed table, which is why the
 * phone is the cheapest of the two surfaces to decide on — a few dozen rows instead of hundreds.
 */
export interface PhoneSpaceOptions {
	readonly app?: string;
	readonly maxTargets?: number;
	readonly maxLabelChars?: number;
	readonly minConfidence?: number;
}

export function buildPhoneActionSpace(observation: MirroringObservation, options: PhoneSpaceOptions = {}): ActionSpace {
	const maxTargets = options.maxTargets ?? MAX_TARGETS_PER_OPERATION;
	const maxLabelChars = options.maxLabelChars ?? 120;
	const minConfidence = options.minConfidence ?? 0;

	const rows: TableElement[] = [];
	const pressTargets: Record<number, Target> = {};
	observation.texts.forEach((entry, index) => {
		const label = entry.text.trim();
		if (label === "" || entry.width <= 0 || entry.height <= 0 || entry.confidence < minConfidence) {
			return;
		}
		if (Object.keys(pressTargets).length >= maxTargets) {
			return;
		}
		const clipped = label.length > maxLabelChars ? label.slice(0, maxLabelChars) : label;
		rows.push({ index, role: "text", label: clipped, operations: ["PRESS"] });
		pressTargets[index] = {
			operation: "PRESS",
			index,
			label: clipped,
			role: "text",
			expectLabel: entry.text,
			expectRole: "text",
		};
	});

	const targets: Partial<Record<"PRESS" | "TYPE_TEXT", Record<number, Target>>> = {};
	if (rows.length > 0) {
		targets.PRESS = pressTargets;
	}

	return {
		platform: "ios",
		app: options.app ?? "iPhone",
		...(options.app === undefined ? {} : { windowTitle: options.app }),
		elements: rows,
		visibleText: rows.slice(0, 40).map((row) => row.label ?? ""),
		targets,
		operations: ["PRESS", "TYPE_TEXT", "SCROLL_UP", "SCROLL_DOWN", "WAIT", "DONE", "BLOCKED"],
		truncated: observation.texts.length > rows.length,
		pruned: 0,
		sparse: rows.length < SPARSE_TARGET_COUNT,
	};
}

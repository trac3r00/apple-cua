import type { AXTreeElement, AppState } from "@apple-cua/core";
import { MAX_TARGETS_PER_OPERATION, SPARSE_TARGET_COUNT } from "./questions.js";
import type { ActionSpace, TableElement, Target, TargetedOperation } from "./types.js";

/**
 * Roles whose whole point is holding text the user can change. Role decides this, never
 * "the value happens to be settable": a checkbox has a value and is not a place to type.
 */
const EDITABLE_ROLES: ReadonlySet<string> = new Set([
	"AXTextField",
	"AXTextArea",
	"AXSearchField",
	"AXSecureTextField",
	"AXComboBox",
]);

/** Roles that only wrap another choice. Dropped when they add nothing the table does not already say. */
const WRAPPER_ROLES: ReadonlySet<string> = new Set(["AXGroup", "AXLayoutArea", "AXLayoutItem", "AXUnknown"]);

/** A control the app itself says cannot be pressed is not offered as pressable, whatever its role. */
const PRESS_ACTION = "AXPress";

export interface ActionSpaceOptions {
	readonly maxTargetsPerOperation?: number;
	readonly maxVisibleText?: number;
	readonly maxLabelChars?: number;
}

interface Candidate {
	readonly element: AXTreeElement;
	readonly operations: readonly TargetedOperation[];
	readonly label: string;
	readonly order: number;
}

export function buildMacActionSpace(state: AppState, options: ActionSpaceOptions = {}): ActionSpace {
	const maxTargets = options.maxTargetsPerOperation ?? MAX_TARGETS_PER_OPERATION;
	const maxVisibleText = options.maxVisibleText ?? 40;
	const maxLabelChars = options.maxLabelChars ?? 120;

	const candidates: Candidate[] = [];
	state.elements.forEach((element, order) => {
		if (element.frame.width <= 0 || element.frame.height <= 0) {
			return;
		}
		const operations = targetedOperationsFor(element);
		if (operations.length === 0) {
			return;
		}
		candidates.push({ element, operations, label: labelOf(element, maxLabelChars), order });
	});

	const byId = new Map(state.elements.map((element) => [element.id, element]));
	const pruned = pruneWrappers(candidates, byId);
	const kept = candidates.filter((candidate) => !pruned.has(candidate.element.id));
	const { allowed, truncated } = capPerOperation(kept, maxTargets);

	const rows: TableElement[] = [];
	const pressTargets: Record<number, Target> = {};
	const typeTargets: Record<number, Target> = {};

	for (const candidate of kept) {
		const id = candidate.element.id;
		const operations = candidate.operations.filter((operation) => allowed.get(operation)?.has(id) === true);
		if (operations.length === 0) {
			continue;
		}
		rows.push({
			index: id,
			role: shortRole(candidate.element.role),
			...(candidate.label === "" ? {} : { label: candidate.label }),
			...(displayValue(candidate.element, maxLabelChars) === ""
				? {}
				: { value: displayValue(candidate.element, maxLabelChars) }),
			operations,
		});
		const target: Target = {
			operation: operations[0] ?? "PRESS",
			index: id,
			label: candidate.label === "" ? shortRole(candidate.element.role) : candidate.label,
			role: shortRole(candidate.element.role),
			expectLabel: candidate.element.label ?? "",
			expectRole: candidate.element.role,
		};
		if (operations.includes("PRESS")) {
			pressTargets[id] = { ...target, operation: "PRESS" };
		}
		if (operations.includes("TYPE_TEXT")) {
			typeTargets[id] = { ...target, operation: "TYPE_TEXT" };
		}
	}

	const targets: Partial<Record<TargetedOperation, Record<number, Target>>> = {};
	if (Object.keys(pressTargets).length > 0) {
		targets.PRESS = pressTargets;
	}
	if (Object.keys(typeTargets).length > 0) {
		targets.TYPE_TEXT = typeTargets;
	}

	const operations = offeredOperations(targets);
	const targetCount = Object.values(targets).reduce((total, map) => total + Object.keys(map).length, 0);

	return {
		platform: "macos",
		app: state.app,
		...(state.windowTitle === undefined ? {} : { windowTitle: state.windowTitle }),
		elements: rows,
		visibleText: visibleTextOf(state, maxVisibleText, maxLabelChars),
		targets,
		operations,
		truncated,
		pruned: pruned.size,
		sparse: targetCount < SPARSE_TARGET_COUNT,
	};
}

/**
 * The operations an element actually supports. `AXPress` is read from the app's own action list, so
 * an element that advertises no press is never offered as pressable — the honest version of the
 * `-25206` refusal the driver already surfaces.
 */
export function targetedOperationsFor(element: AXTreeElement): TargetedOperation[] {
	const operations: TargetedOperation[] = [];
	if (EDITABLE_ROLES.has(element.role)) {
		operations.push("TYPE_TEXT");
	}
	if (element.actions.includes(PRESS_ACTION)) {
		operations.push("PRESS");
	}
	return operations;
}

/**
 * Containers that exist only to wrap a choice already in the table. A flat table turns them into
 * dozens of rows that read alike and differ only by number, which is the same failure the browser
 * agent measured: the size of the choice is the accuracy.
 */
function pruneWrappers(candidates: readonly Candidate[], byId: ReadonlyMap<number, AXTreeElement>): Set<number> {
	const candidateIds = new Set(candidates.map((candidate) => candidate.element.id));
	const pruned = new Set<number>();
	for (const candidate of candidates) {
		if (!WRAPPER_ROLES.has(candidate.element.role)) {
			continue;
		}
		const inside = descendants(candidate.element, byId, candidateIds);
		if (inside.length === 0) {
			if (candidate.label === "") {
				pruned.add(candidate.element.id);
			}
			continue;
		}
		const wrapsOnly = candidate.label === "" || inside.some((id) => byId.get(id)?.label === candidate.element.label);
		if (wrapsOnly) {
			pruned.add(candidate.element.id);
		}
	}
	return pruned;
}

function descendants(
	element: AXTreeElement,
	byId: ReadonlyMap<number, AXTreeElement>,
	candidateIds: ReadonlySet<number>,
): number[] {
	const found: number[] = [];
	const stack = [...element.children];
	while (stack.length > 0) {
		const id = stack.pop();
		if (id === undefined) {
			continue;
		}
		const child = byId.get(id);
		if (child === undefined) {
			continue;
		}
		if (candidateIds.has(id)) {
			found.push(id);
		}
		stack.push(...child.children);
	}
	return found;
}

/** Keep the named controls first, then the tree's own order, and say when something was dropped. */
function capPerOperation(
	kept: readonly Candidate[],
	maxTargets: number,
): { readonly allowed: Map<TargetedOperation, Set<number>>; readonly truncated: boolean } {
	const allowed = new Map<TargetedOperation, Set<number>>();
	let truncated = false;
	for (const operation of ["PRESS", "TYPE_TEXT"] as const) {
		const matching = kept.filter((candidate) => candidate.operations.includes(operation));
		const ordered = [
			...matching.filter((candidate) => candidate.label !== ""),
			...matching.filter((candidate) => candidate.label === ""),
		].sort((left, right) => left.order - right.order);
		const keptIds = ordered.slice(0, maxTargets).map((candidate) => candidate.element.id);
		if (ordered.length > maxTargets) {
			truncated = true;
		}
		allowed.set(operation, new Set(keptIds));
	}
	return { allowed, truncated };
}

function offeredOperations(
	targets: Readonly<Partial<Record<TargetedOperation, Record<number, Target>>>>,
): TargetedOperation[] {
	const operations: TargetedOperation[] = [];
	if (targets.PRESS !== undefined) {
		operations.push("PRESS");
	}
	if (targets.TYPE_TEXT !== undefined) {
		operations.push("TYPE_TEXT");
	}
	return operations;
}

function visibleTextOf(state: AppState, maxVisibleText: number, maxLabelChars: number): string[] {
	const seen = new Set<string>();
	const text: string[] = [];
	for (const element of state.elements) {
		if (element.role !== "AXStaticText" && element.role !== "AXHeading") {
			continue;
		}
		const value = labelOf(element, maxLabelChars);
		if (value === "" || seen.has(value)) {
			continue;
		}
		seen.add(value);
		text.push(value);
		if (text.length >= maxVisibleText) {
			break;
		}
	}
	return text;
}

/**
 * The element's name. Never its value: a text area whose current contents were shown as its label
 * reads to the decision model as a field that already holds the goal text, and it stops being able
 * to tell a name from a value.
 */
function labelOf(element: AXTreeElement, maxLabelChars: number): string {
	const source = element.label ?? "";
	return source.length > maxLabelChars ? source.slice(0, maxLabelChars) : source;
}

function displayValue(element: AXTreeElement, maxLabelChars: number): string {
	const source = element.value ?? "";
	return source.length > maxLabelChars ? source.slice(0, maxLabelChars) : source;
}

function shortRole(role: string): string {
	return role.startsWith("AX") ? role.slice(2) : role;
}

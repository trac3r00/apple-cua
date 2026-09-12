import { randomUUID } from "node:crypto";
import { resolveAppPid } from "@macos-cua/core";
import type { AppState, GuardedComputerInterface, InputObservation, Point, Rect } from "@macos-cua/core";
import {
	type ToolResult,
	observedActionResult,
	postActionErrorResult,
	stateResult,
	textResult,
} from "./tool-result.js";

const STRICT_STATE_OPTIONS = { requireWindow: true } as const;
const STRICT_DIFF_STATE_OPTIONS = { diffOnly: true, requireWindow: true } as const;

type Mutation = (targetPid: number, observation: InputObservation) => Promise<void>;
type Validation = (observation: InputObservation) => void;

export class GuardedSession {
	private active: { readonly token: string; readonly observation: InputObservation } | undefined;
	private tail: Promise<void> = Promise.resolve();
	private closed = false;
	private closePromise: Promise<void> | undefined;

	constructor(private readonly computer: GuardedComputerInterface) {}

	listApps(): Promise<ToolResult> {
		return this.enqueue(async () => textResult(JSON.stringify(await this.computer.listApps(), null, 2)));
	}

	observe(app: string, diffOnly: boolean): Promise<ToolResult> {
		return this.enqueue(async () => {
			this.active = undefined;
			const targetPid = await resolveAppPid(this.computer, app);
			const state = await this.computer.getAppState(
				targetPid,
				diffOnly ? STRICT_DIFF_STATE_OPTIONS : STRICT_STATE_OPTIONS,
			);
			this.assertOpen();
			const observation = this.computer.getInputObservation(targetPid);
			const token =
				observation !== undefined && observationMatchesState(observation, state)
					? this.issue(observation)
					: undefined;
			return stateResult(state, token);
		});
	}

	mutate(token: string, app: string, validate: Validation, action: Mutation): Promise<ToolResult> {
		return this.enqueue(async () => {
			const expected = this.consume(token);
			const targetPid = await resolveAppPid(this.computer, app);
			if (targetPid !== expected.pid) {
				throw new Error("requested app does not match the token observation");
			}
			validate(expected);
			const preflight = await this.computer.preflightInput(expected);
			if (!preflight.ok) {
				throw new Error(`input preflight rejected: ${preflight.reason}`);
			}
			this.assertOpen();
			await action(targetPid, expected);
			try {
				this.assertOpen();
				const state = await this.computer.getAppState(targetPid, STRICT_STATE_OPTIONS);
				this.assertOpen();
				const current = this.computer.getInputObservation(targetPid);
				const contextUnchanged =
					current !== undefined &&
					state.frontmost &&
					observationMatchesState(current, state) &&
					sameInputContext(expected, current);
				const changed = hasAxChange(state);
				const nextToken = contextUnchanged && changed ? this.issue(current) : undefined;
				return observedActionResult(state, contextUnchanged, nextToken);
			} catch (error: unknown) {
				this.active = undefined;
				return postActionErrorResult(error);
			}
		});
	}

	invalidate(): void {
		this.closed = true;
		this.active = undefined;
	}

	async close(): Promise<void> {
		this.invalidate();
		this.closePromise ??= this.tail.then(async () => this.computer.close());
		await this.closePromise;
	}

	private issue(observation: InputObservation): string {
		const token = randomUUID();
		this.active = { token, observation };
		return token;
	}

	private consume(token: string): InputObservation {
		const active = this.active;
		if (active === undefined || active.token !== token) {
			throw new Error("observation token is missing, stale, or already consumed");
		}
		this.active = undefined;
		return active.observation;
	}

	private assertOpen(): void {
		if (this.closed) {
			throw new Error("MCP computer session is closed");
		}
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.tail.then(async () => {
			this.assertOpen();
			return await operation();
		});
		this.tail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}
}

export function validateElement(observation: InputObservation, elementIndex: number): void {
	if (!observation.observedElementIds.has(elementIndex)) {
		throw new Error(`element index ${elementIndex} was not present in the token observation`);
	}
}

export function validatePoint(observation: InputObservation, point: Point): void {
	const { width, height } = observation.screenshotViewport;
	if (
		!Number.isFinite(point.x) ||
		!Number.isFinite(point.y) ||
		point.x < 0 ||
		point.y < 0 ||
		point.x >= width ||
		point.y >= height
	) {
		throw new Error(`coordinates must be within the observed viewport [0, ${width}) x [0, ${height})`);
	}
}

export function observedPointToScreen(observation: InputObservation, point: Point): Point {
	validatePoint(observation, point);
	const viewport = observation.screenshotViewport;
	return {
		x: viewport.bounds.x + (point.x / viewport.width) * viewport.bounds.width,
		y: viewport.bounds.y + (point.y / viewport.height) * viewport.bounds.height,
	};
}

function observationMatchesState(observation: InputObservation, state: AppState): boolean {
	return (
		observation.pid === state.pid &&
		observation.bundleId === state.bundleId &&
		state.windowBounds !== undefined &&
		rectsEqual(observation.windowBounds, state.windowBounds) &&
		observation.screenshotViewport.width === state.screenshotWidth &&
		observation.screenshotViewport.height === state.screenshotHeight
	);
}

function sameInputContext(before: InputObservation, after: InputObservation): boolean {
	return (
		before.pid === after.pid &&
		before.bundleId === after.bundleId &&
		before.windowId === after.windowId &&
		rectsEqual(before.windowBounds, after.windowBounds) &&
		rectsEqual(before.screenshotViewport.bounds, after.screenshotViewport.bounds) &&
		before.screenshotViewport.width === after.screenshotViewport.width &&
		before.screenshotViewport.height === after.screenshotViewport.height
	);
}

function rectsEqual(left: Rect, right: Rect): boolean {
	return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

function hasAxChange(state: AppState): boolean {
	const summary = state.axChangeSummary;
	return summary !== undefined && summary.added + summary.removed + summary.changed > 0;
}

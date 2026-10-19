import { randomUUID } from "node:crypto";
import { resolveAppPid, withCursorIdentity } from "@apple-cua/core";
import type { GuardedComputerInterface } from "@apple-cua/core";
import type {
	GuardedSession,
	MutationOptions,
	ObservationOptions,
	RunControl,
	VerifyRequest,
} from "./guarded-session.js";
import { createRunStepDriver } from "./step-actions.js";
import type { ToolResult } from "./tool-result.js";
import type { RunStep } from "./tool-schemas.js";

export type WorkerAssignmentInput = {
	readonly worker_id: string;
	readonly task: string;
	readonly app: string;
};

export type WorkerAssignment = WorkerAssignmentInput & {
	readonly cursor_id: string;
	readonly observation_token?: string;
	readonly observation?: ToolResult;
};

export type WorkerStatus = Omit<WorkerAssignment, "observation"> & {
	readonly busy: boolean;
};

export type WorkerObservationOptions = Omit<ObservationOptions, "includeAccessibilityTree">;

export type WorkerObservation = {
	readonly worker_id: string;
	readonly task: string;
	readonly app: string;
	readonly cursor_id: string;
	readonly observation_token?: string;
	readonly result: ToolResult;
};

export type WorkerRunResult = {
	readonly worker_id: string;
	readonly task: string;
	readonly app: string;
	readonly cursor_id: string;
	readonly observation_token?: string;
	readonly result: ToolResult;
};

type WorkerState = {
	assignment: WorkerAssignmentInput & {
		readonly cursor_id: string;
		observation_token: string | undefined;
		observation: ToolResult | undefined;
	};
	readonly pid: number;
	busy: boolean;
};

function payload(result: ToolResult): Record<string, unknown> {
	const text = result.content.find((content) => content.type === "text");
	if (text === undefined || text.type !== "text") {
		throw new Error("guarded observation did not return JSON text");
	}
	const value: unknown = JSON.parse(text.text);
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("guarded observation payload must be an object");
	}
	return Object.fromEntries(Object.entries(value));
}

export class WorkerCoordinator {
	private readonly workers = new Map<string, WorkerState>();
	private attendedTail: Promise<void> = Promise.resolve();
	private closed = false;

	constructor(
		private readonly session: GuardedSession,
		private readonly computer: GuardedComputerInterface,
	) {
		// The shared session owns token validation and per-app mutation queues.
	}

	async assign(assignments: readonly WorkerAssignmentInput[]): Promise<readonly WorkerAssignment[]> {
		this.assertOpen();
		const workerIds = new Set<string>();
		const pids = new Set<number>();
		const resolved = await Promise.all(
			assignments.map(async (assignment) => ({
				assignment,
				pid: await resolveAppPid(this.computer, assignment.app),
			})),
		);
		this.assertOpen();
		for (const { assignment, pid } of resolved) {
			if (workerIds.has(assignment.worker_id) || this.workers.has(assignment.worker_id)) {
				throw new Error(`worker "${assignment.worker_id}" is already assigned`);
			}
			if (pids.has(pid) || [...this.workers.values()].some((worker) => worker.pid === pid)) {
				throw new Error(`app "${assignment.app}" is already owned`);
			}
			workerIds.add(assignment.worker_id);
			pids.add(pid);
		}

		const provisional = resolved.map(({ assignment, pid }) => {
			const worker: WorkerState = {
				assignment: {
					...assignment,
					cursor_id: randomUUID(),
					observation_token: undefined,
					observation: undefined,
				},
				pid,
				busy: true,
			};
			this.workers.set(assignment.worker_id, worker);
			return worker;
		});
		try {
			const settled = await Promise.allSettled(
				provisional.map(async (worker) => ({ worker, observed: await this.observeState(worker, {}) })),
			);
			// Keep every app claimed until all sibling reads finish, even when one fails.
			const observations = settled.map((outcome) => {
				if (outcome.status === "rejected") {
					throw outcome.reason;
				}
				return outcome.value;
			});
			this.assertOpen();
			for (const { worker, observed } of observations) {
				if (observed.observation_token === undefined) {
					throw new Error(`worker "${worker.assignment.worker_id}" observation did not issue a token`);
				}
			}
			// Publish the batch only when every claimed app has usable context.
			return observations.map(({ worker, observed }) => {
				worker.assignment = {
					...worker.assignment,
					observation_token: observed.observation_token,
					observation: observed.result,
				};
				worker.busy = false;
				const { worker_id, task, app, cursor_id } = worker.assignment;
				return {
					worker_id,
					task,
					app,
					cursor_id,
					...(observed.observation_token === undefined ? {} : { observation_token: observed.observation_token }),
					observation: observed.result,
				};
			});
		} catch (error: unknown) {
			for (const worker of provisional) {
				this.workers.delete(worker.assignment.worker_id);
			}
			throw error;
		}
	}

	async observe(workerId: string, options: WorkerObservationOptions = {}): Promise<WorkerObservation> {
		this.assertOpen();
		const worker = this.workers.get(workerId);
		if (worker === undefined) {
			throw new Error(`worker "${workerId}" is not assigned`);
		}
		if (worker.busy) {
			throw new Error(`worker "${workerId}" is busy`);
		}
		worker.busy = true;
		worker.assignment = { ...worker.assignment, observation_token: undefined };
		try {
			const result = await this.observeState(worker, options);
			worker.assignment = {
				...worker.assignment,
				observation_token: result.observation_token,
				observation: result.result,
			};
			return result;
		} finally {
			worker.busy = false;
		}
	}

	status(): readonly WorkerStatus[] {
		return [...this.workers.values()].flatMap(({ assignment, busy }) => {
			if (assignment.observation === undefined) {
				return [];
			}
			return [
				{
					worker_id: assignment.worker_id,
					task: assignment.task,
					app: assignment.app,
					cursor_id: assignment.cursor_id,
					...(assignment.observation_token === undefined
						? {}
						: { observation_token: assignment.observation_token }),
					busy,
				},
			];
		});
	}

	release(workerId: string): void {
		this.assertOpen();
		const worker = this.workers.get(workerId);
		if (worker === undefined) {
			throw new Error(`worker "${workerId}" is not assigned`);
		}
		if (worker.busy) {
			throw new Error(`worker "${workerId}" is busy`);
		}
		this.workers.delete(workerId);
	}

	async run(
		workerId: string,
		token: string,
		steps: readonly RunStep[],
		expect: VerifyRequest | undefined,
		resultOptions: MutationOptions = {},
		executionOptions: RunControl = {},
	): Promise<WorkerRunResult> {
		this.assertOpen();
		const worker = this.workers.get(workerId);
		if (worker === undefined) {
			throw new Error(`worker "${workerId}" is not assigned`);
		}
		if (worker.busy) {
			throw new Error(`worker "${workerId}" is busy`);
		}
		if (token !== worker.assignment.observation_token) {
			throw new Error(`observation token does not belong to worker "${workerId}"`);
		}
		worker.busy = true;
		worker.assignment = { ...worker.assignment, observation_token: undefined };
		try {
			const dispatch = () =>
				withCursorIdentity(worker.assignment.cursor_id, () =>
					this.session.runSteps(
						token,
						String(worker.pid),
						steps,
						expect,
						createRunStepDriver(this.computer),
						resultOptions,
						executionOptions,
					),
				);
			const pending = this.computer.delivery === "background" ? dispatch() : this.attendedTail.then(dispatch);
			if (this.computer.delivery !== "background") {
				this.attendedTail = pending.then(
					() => undefined,
					() => undefined,
				);
			}
			const result = await pending;
			const nextToken = payload(result)["observation_token"];
			if (typeof nextToken === "string") {
				worker.assignment = { ...worker.assignment, observation_token: nextToken, observation: result };
			}
			const { worker_id, task, app, cursor_id } = worker.assignment;
			return {
				worker_id,
				task,
				app,
				cursor_id,
				...(typeof nextToken === "string" ? { observation_token: nextToken } : {}),
				result,
			};
		} finally {
			worker.busy = false;
		}
	}

	async close(): Promise<void> {
		this.closed = true;
		this.workers.clear();
		await this.session.close();
	}

	private assertOpen(): void {
		if (this.closed) {
			this.workers.clear();
			throw new Error("worker coordinator is closed");
		}
	}

	private async observeState(worker: WorkerState, options: WorkerObservationOptions): Promise<WorkerObservation> {
		if (
			worker.assignment.observation !== undefined &&
			(await resolveAppPid(this.computer, worker.assignment.app)) !== worker.pid
		) {
			throw new Error(`worker "${worker.assignment.worker_id}" app process changed; release and reassign it`);
		}
		const result = await withCursorIdentity(worker.assignment.cursor_id, () =>
			this.session.observe({
				...options,
				app: String(worker.pid),
				diffOnly: false,
				includeAccessibilityTree: true,
				includeScreenshot: options.includeScreenshot ?? true,
			}),
		);
		const previous = worker.assignment.observation;
		if (previous !== undefined && payload(previous)["bundleId"] !== payload(result)["bundleId"]) {
			throw new Error(`worker "${worker.assignment.worker_id}" app identity changed; release and reassign it`);
		}
		const token = payload(result)["observation_token"];
		const { worker_id, task, app, cursor_id } = worker.assignment;
		return {
			worker_id,
			task,
			app,
			cursor_id,
			...(typeof token === "string" ? { observation_token: token } : {}),
			result,
		};
	}
}

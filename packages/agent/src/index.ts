export type {
	ActionSpace,
	Decision,
	DecisionOutcome,
	DecisionRefusal,
	Operation,
	RiskClass,
	TableElement,
	Target,
	TargetedOperation,
} from "./types.js";
export { RISK_CLASSES, TARGETED_OPERATIONS } from "./types.js";
export { buildMacActionSpace, targetedOperationsFor, type ActionSpaceOptions } from "./action-space.js";
export { buildPhoneActionSpace, type PhoneSpaceOptions } from "./phone-space.js";
export {
	createDecider,
	questionsFor,
	targetQuestion,
	validate,
	type DecisionConfig,
	type DecisionRequest,
	type Decider,
	type HistoryEntry,
} from "./decision.js";
export {
	DecisionAgent,
	type DecisionAgentOptions,
	type StepRecord,
	type StepStatus,
} from "./loop.js";
export {
	macosAdapter,
	phoneAdapter,
	type MacAdapterOptions,
	type PhoneAdapterOptions,
	type PhoneHands,
} from "./adapters.js";
export type { ExecutionResult, Observation, PlatformAdapter } from "./adapter.js";
export {
	CONFIDENCE_FLOOR,
	DONE_THRESHOLD,
	MAX_DECISIONS,
	MAX_OPERATIONS,
	MAX_TARGETS_PER_OPERATION,
	RISK_THRESHOLD,
	SPARSE_TARGET_COUNT,
} from "./questions.js";

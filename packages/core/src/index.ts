export type * from "./accessibility/types.js";
export { classifyContentKind, type ContentKind } from "./accessibility/content-kind.js";
export { diffAxTreeChanges, type AxTreeChanges } from "./accessibility/diff.js";
export {
	AX_PRESS_ACTION,
	axScrollActionFor,
	clickPoint,
	getAppStateForApp,
	observeAction,
	parseElementIndex,
	parseKeyChord,
	pressElement,
	resolveAppPid,
	resolvePointForElement,
	scrollElement,
	withTargetedApp,
	type ComputerUseMouseButton,
} from "./computer/actions.js";
export { resolveScreenPoint } from "./computer/coordinate.js";
export { pressKeySequence, type KeySequenceEntry, type KeySequenceOptions } from "./computer/key-sequence.js";
export {
	type SelectionMode,
	type SelectionRange,
	type SelectionRangeInput,
	resolveSelectionRange,
} from "./computer/select-text.js";
export type {
	GuardedComputerInterface,
	InputObservation,
	PreflightResult,
} from "./computer/guarded-interface.js";
export type { ComputerInterface, ScreenshotResult } from "./computer/interface.js";
export {
	MAX_SCREENSHOT_LONG_EDGE,
	type ScreenshotViewport,
	resolveWindowScreenshotSize,
	screenRectToScreenshot,
	screenshotPointToScreen,
} from "./computer/viewport.js";
export { type AppApprovalDecision, AppApprovalStore } from "./permission/app-approval.js";
export { type LockScreenMonitorCallbacks, LockScreenMonitor } from "./platform/lock-screen-monitor.js";
export {
	type PassiveMemoryConfig,
	type PassiveMemoryContext,
	shouldRecord,
} from "./passive-memory/exclusion-policy.js";
export {
	type SegmentSink,
	PassiveMemorySegmentWriter,
	fileSegmentSink,
} from "./passive-memory/segment-writer.js";
export type { PermissionInterface, PermissionKind, PermissionStatus } from "./permission/interface.js";
export { MacOSPermissions } from "./permission/macos.js";
export { CloudComputer, type CloudComputerOptions } from "./platform/cloud.js";
export { HostComputer, type HostComputerOptions } from "./platform/host.js";
export { MacOSHostComputer, type MacOSHostComputerOptions } from "./platform/macos.js";
export {
	type PointerMode,
	type PointerOverlay,
	NOOP_POINTER_OVERLAY,
	createCursorOverlay,
} from "./platform/macos-ffi/cursor-overlay.js";
export { VMComputer, type VMComputerOptions } from "./platform/vm.js";
export type {
	ComputerCapabilities,
	DragOptions,
	AppStateOptions,
	KeyOptions,
	Point,
	Rect,
	ScreenshotOptions,
	ScrollOptions,
	SelectTextOptions,
	Size,
} from "./types/index.js";
export type { WindowInfo, WindowInterface } from "./window/interface.js";
export { MacOSWindows } from "./window/macos.js";

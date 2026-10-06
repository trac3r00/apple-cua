export type * from "./accessibility/types.js";
export { classifyContentKind, type ContentKind } from "./accessibility/content-kind.js";
export { diffAxTreeChanges, type AxTreeChanges } from "./accessibility/diff.js";
export {
	type ElementMatch,
	type ElementQuery,
	describeQuery,
	matchElements,
	suggestNearMisses,
} from "./accessibility/element-query.js";
export {
	AX_PRESS_ACTION,
	axScrollActionFor,
	clickPoint,
	findMatchingApp,
	getAppStateForApp,
	normalizeModifiers,
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
export {
	type InputScope,
	type InputTarget,
	InputInterrupted,
	currentInputScope,
	runInInputScope,
} from "./computer/input-scope.js";
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
	PreflightOptions,
	PreflightResult,
} from "./computer/guarded-interface.js";
export type { ComputerInterface, ScreenshotResult, WindowTextRead } from "./computer/interface.js";
export {
	type TopLevelWindow,
	type TopLevelWindowOptions,
	type WindowProbe,
	fillWindowTitles,
	listTopLevelWindows,
} from "./platform/macos-top-level-windows.js";
export { type ListedWindow, listWindows } from "./platform/macos-ffi/window-list.js";
export {
	type SystemPrompt,
	type SystemPromptKind,
	classifySystemPrompts,
	currentSystemPrompts,
	setSystemPromptWindowSourceForTesting,
} from "./platform/system-prompts.js";
export {
	MAX_SCREENSHOT_LONG_EDGE,
	type ScreenshotViewport,
	resolveWindowScreenshotSize,
	screenRectToScreenshot,
	screenshotPointToScreen,
} from "./computer/viewport.js";
export { type AppApprovalDecision, AppApprovalStore } from "./permission/app-approval.js";
export { type LockScreenMonitorCallbacks, LockScreenMonitor } from "./platform/lock-screen-monitor.js";
export { type HostCapabilities, probeHostCapabilities } from "./platform/host-capabilities.js";
export { getSckitLoadError, isSckitAvailable } from "./platform/macos-ffi/sckit.js";
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
export type { InputDelivery } from "./platform/macos-input.js";
export { invokeMenu, type InvokeMenuResult } from "./platform/macos-menu.js";
export {
	type AppLister,
	type AppOpenLauncher,
	type OpenApplicationOptions,
	type OpenApplicationResult,
	openApplication,
	openArguments,
	spawnOpenLauncher,
} from "./platform/macos-open-app.js";
export { setWindowFrame } from "./platform/macos-window-frame.js";
export {
	type OcrBox,
	type OcrTextObservation,
	type RecognizeTextOptions,
	filterByMinimumConfidence,
	isVisionOcrAvailable,
	readImagePixelSize,
	recognizeTextInFile,
	recognizeTextInImage,
} from "./platform/macos-ffi/vision.js";
export { renamedEnvironmentVariable } from "./platform/renamed-environment.js";
export {
	type StopSource,
	type StopStatus,
	type StopStatusSource,
	STATE_DIR_ENV,
	StopSwitch,
	describeUserStop,
	resolveStateDir,
} from "./platform/stop-switch.js";
export {
	type StopChordDetectorOptions,
	type StopChordTimer,
	STOP_CHORD_LABEL,
	STOP_CHORD_MASK,
	StopChordDetector,
	startStopChordDetector,
} from "./platform/stop-chord.js";
export { readHidModifierFlags } from "./platform/macos-ffi/event-flags.js";
export {
	type IOSDelivery,
	type IOSInputTarget,
	type IOSScrollOptions,
	type KeystrokePlanEntry,
	type SwipeKind,
	type SwipeOptions,
	comboParts,
	gesturePath,
	longPressMirroring,
	pressMirroringCombo,
	scrollMirroring,
	swipeDurationMs,
	swipeMirroring,
	tapMirroring,
	typeIntoMirroring,
	typingPlan,
} from "./platform/ios-input.js";
export {
	IPHONE_MIRRORING_APP_NAME,
	IPHONE_MIRRORING_BUNDLE_ID,
	type IPhoneMirroringOptions,
	type MirroringAxEntry,
	type MirroringFocusProbe,
	type MirroringObservation,
	type MirroringSessionState,
	type MirroringText,
	type MirroringWindow,
	IPhoneMirroring,
	activateMirroring,
	captureMirroringWindow,
	classifyMirroringSession,
	describeInterruption,
	describeMirroringState,
	findMirroringWindow,
	findTexts,
	isMirroringFrontmost,
	mirroringProcess,
	mirroringSessionStatus,
	mirroringWindowAxContent,
	observeMirroring,
	ocrTextsToScreenPoints,
	probeMirroringFocus,
	requireMirroringSession,
	requireMirroringWindow,
	requireMirroringWindowAt,
	selectMirroringWindow,
	toMirroringWindow,
	windowOwnsPoint,
} from "./platform/ios-mirroring.js";
export {
	type ClipboardWriteInput,
	type ClipboardWriteResult,
	readClipboard,
	writeClipboard,
} from "./platform/macos-ffi/pasteboard.js";
export {
	type PointerMode,
	type PointerOverlay,
	NOOP_POINTER_OVERLAY,
	createCursorOverlay,
} from "./platform/macos-ffi/cursor-overlay.js";
export { VMComputer, type VMComputerOptions } from "./platform/vm.js";
export {
	DEFAULT_AX_MESSAGING_TIMEOUT_SECONDS,
	resolveAxMessagingTimeoutSeconds,
} from "./platform/macos-ffi/accessibility.js";
export type {
	ComputerCapabilities,
	DragOptions,
	AppStateOptions,
	KeyModifierName,
	KeyOptions,
	Point,
	PointerOptions,
	Rect,
	ScreenshotOptions,
	ScrollOptions,
	SelectTextOptions,
	Size,
} from "./types/index.js";
export type { WindowInfo, WindowInterface } from "./window/interface.js";
export { MacOSWindows } from "./window/macos.js";

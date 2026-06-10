export type * from "./accessibility/types.js";
export {
	AX_PRESS_ACTION,
	axScrollActionFor,
	clickPoint,
	getAppStateForApp,
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
	type SelectionMode,
	type SelectionRange,
	type SelectionRangeInput,
	resolveSelectionRange,
} from "./computer/select-text.js";
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
export type { PermissionInterface, PermissionKind, PermissionStatus } from "./permission/interface.js";
export { MacOSPermissions } from "./permission/macos.js";
export { CloudComputer, type CloudComputerOptions } from "./platform/cloud.js";
export { HostComputer, type HostComputerOptions } from "./platform/host.js";
export { MacOSHostComputer, type MacOSHostComputerOptions } from "./platform/macos.js";
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

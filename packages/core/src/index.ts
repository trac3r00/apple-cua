export type {
	Point,
	Size,
	Rect,
	ScreenshotOptions,
	KeyOptions,
	ScrollOptions,
	DragOptions,
	ComputerCapabilities,
} from "./types/index.js";

export type { ScreenshotResult, ComputerInterface } from "./computer/interface.js";

export { HostComputer, type HostComputerOptions } from "./platform/host.js";
export { VMComputer, type VMComputerOptions } from "./platform/vm.js";
export { CloudComputer, type CloudComputerOptions } from "./platform/cloud.js";
export { MacOSHostComputer } from "./platform/macos.js";
export type { PermissionInterface, PermissionStatus, PermissionKind } from "./permission/interface.js";
export { MacOSPermissions } from "./permission/macos.js";
export type { WindowInterface, WindowInfo } from "./window/interface.js";
export { MacOSWindows } from "./window/macos.js";

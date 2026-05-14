export type * from "./accessibility/types.js";
export type { ComputerInterface, ScreenshotResult } from "./computer/interface.js";
export type { PermissionInterface, PermissionKind, PermissionStatus } from "./permission/interface.js";
export { MacOSPermissions } from "./permission/macos.js";
export { CloudComputer, type CloudComputerOptions } from "./platform/cloud.js";
export { HostComputer, type HostComputerOptions } from "./platform/host.js";
export { MacOSHostComputer, type MacOSHostComputerOptions } from "./platform/macos.js";
export {
	type HelperError,
	HelperNotAvailableError,
	MacOSCuaHelper,
	MacOSCuaHelperError,
	type MacOSCuaHelperOptions,
	resolveHelperBinaryPath,
} from "./platform/macos-helper.js";
export { VMComputer, type VMComputerOptions } from "./platform/vm.js";
export type {
	ComputerCapabilities,
	DragOptions,
	KeyOptions,
	Point,
	Rect,
	ScreenshotOptions,
	ScrollOptions,
	Size,
} from "./types/index.js";
export type { WindowInfo, WindowInterface } from "./window/interface.js";
export { MacOSWindows } from "./window/macos.js";

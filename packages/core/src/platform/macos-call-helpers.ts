/** Apple hosts Phone/FaceTime call banners outside the regular application process. */
const CALL_HOST_PATHS = new Map([
	["com.apple.notificationcenterui", "/System/Library/CoreServices/NotificationCenter.app"],
	[
		"com.apple.FaceTime.FaceTimeNotificationExtension",
		"/System/Library/ExtensionKit/Extensions/FaceTimeNotificationExtension.appex",
	],
	[
		"com.apple.facetime.NotificationViewBridgeService",
		"/System/Library/PrivateFrameworks/FaceTimeNotificationViewBridge.framework/Versions/A/XPCServices/FaceTimeNotificationViewBridgeService.xpc",
	],
	[
		"com.apple.facetime.NotificationService",
		"/System/Library/PrivateFrameworks/FaceTimeNotification.framework/Versions/A/XPCServices/FaceTimeNotificationService.xpc",
	],
]);

export function isSystemCallHost(bundleId: string, path: string): boolean {
	return CALL_HOST_PATHS.get(bundleId) === path;
}

/** Discovery does not confer approval: helpers retain their own bundle identity. */
export function isDiscoverableApplication(activationPolicy: number, bundleId: string, path: string): boolean {
	return activationPolicy === 0 || isSystemCallHost(bundleId, path);
}

import AppKit
import ApplicationServices

// Observe creation before opening the document. No app activation or input.
let bundle = CommandLine.arguments.count > 3 ? CommandLine.arguments[3] : "com.apple.TextEdit"
let closing = CommandLine.arguments.count > 2 && CommandLine.arguments[2] == "closed"
if !closing && NSRunningApplication.runningApplications(withBundleIdentifier: bundle).first == nil {
	let center = NSWorkspace.shared.notificationCenter
	let launchObserver = center.addObserver(
		forName: NSWorkspace.didLaunchApplicationNotification, object: nil, queue: .main
	) { notification in
		guard
			let launched = notification.userInfo?[NSWorkspace.applicationUserInfoKey]
				as? NSRunningApplication,
			launched.bundleIdentifier == bundle
		else { return }
		CFRunLoopStop(CFRunLoopGetMain())
	}
	let launchDeadline = Timer.scheduledTimer(withTimeInterval: 10, repeats: false) { _ in exit(4) }
	print("SUBSCRIBED")
	fflush(stdout)
	// The launch watcher is installed before the caller opens its fixture.
	if NSRunningApplication.runningApplications(withBundleIdentifier: bundle).first == nil {
		CFRunLoopRun()
	}
	launchDeadline.invalidate()
	center.removeObserver(launchObserver)
}
let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundle).first
guard let app = app else {
	fputs("Target app must already be running\n", stderr)
	exit(1)
}
let target = CommandLine.arguments[1]
let element = AXUIElementCreateApplication(app.processIdentifier)
var observer: AXObserver?
var closingTarget: AXUIElement?
func matchesTitle(_ text: String) -> Bool {
	return target == "*" || text == target || text.hasSuffix(" — " + target)
}
func check() {
	var windows: CFTypeRef?
	guard
		AXUIElementCopyAttributeValue(element, kAXWindowsAttribute as CFString, &windows)
			== .success,
		let items = windows as? [AXUIElement]
	else { return }
	var found = false
	for item in items {
		var title: CFTypeRef?
		if AXUIElementCopyAttributeValue(item, kAXTitleAttribute as CFString, &title) == .success,
			let text = title as? String, matchesTitle(text)
		{
			found = true
		}
	}
	if found != closing {
		print("READY")
		fflush(stdout)
		exit(0)
	}
}
let callback: AXObserverCallback = { observing, item, notification, _ in
	if notification as String == kAXWindowCreatedNotification {
		AXObserverAddNotification(observing, item, kAXTitleChangedNotification as CFString, nil)
	}
	if closing, notification as String == kAXUIElementDestroyedNotification,
		let expected = closingTarget, CFEqual(expected, item)
	{
		print("READY")
		fflush(stdout)
		exit(0)
	}
	check()
}
guard AXObserverCreate(app.processIdentifier, callback, &observer) == .success,
	let observer = observer
else { exit(2) }
if !closing {
	let registration = AXObserverAddNotification(
		observer, element, kAXWindowCreatedNotification as CFString, nil)
	guard registration == .success else {
		fputs("Window-created registration error: \(registration.rawValue)\n", stderr)
		exit(3)
	}
}
CFRunLoopAddSource(CFRunLoopGetCurrent(), AXObserverGetRunLoopSource(observer), .defaultMode)
if closing {
	var windows: CFTypeRef?
	if AXUIElementCopyAttributeValue(element, kAXWindowsAttribute as CFString, &windows)
		== .success,
		let items = windows as? [AXUIElement]
	{
		for item in items {
			var title: CFTypeRef?
			if AXUIElementCopyAttributeValue(item, kAXTitleAttribute as CFString, &title)
				== .success,
				let text = title as? String, matchesTitle(text)
			{
				closingTarget = item
				guard
					AXObserverAddNotification(
						observer, item, kAXUIElementDestroyedNotification as CFString, nil)
						== .success
				else { exit(5) }
			}
		}
	}
}
if !closing {
	var windows: CFTypeRef?
	if AXUIElementCopyAttributeValue(element, kAXWindowsAttribute as CFString, &windows)
		== .success,
		let items = windows as? [AXUIElement]
	{
		for item in items {
			AXObserverAddNotification(observer, item, kAXTitleChangedNotification as CFString, nil)
		}
	}
}
print("SUBSCRIBED")
fflush(stdout)
check()
Timer.scheduledTimer(withTimeInterval: 10, repeats: false) { _ in exit(4) }
RunLoop.current.run()

import AppKit
import ApplicationServices
import Darwin
import Dispatch

let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.finder").first
guard let app = app else { fputs("Finder is not running\n", stderr); exit(1) }
let element = AXUIElementCreateApplication(app.processIdentifier)
var observer: AXObserver?
let callback: AXObserverCallback = { _, _, notification, _ in
	if notification as String == kAXWindowCreatedNotification {
		print("WINDOW")
		fflush(stdout)
	}
}
guard AXObserverCreate(app.processIdentifier, callback, &observer) == .success,
	let observer = observer,
	AXObserverAddNotification(observer, element, kAXWindowCreatedNotification as CFString, nil) == .success
else { exit(2) }
CFRunLoopAddSource(CFRunLoopGetCurrent(), AXObserverGetRunLoopSource(observer), .defaultMode)
let path = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : nil
var source: DispatchSourceFileSystemObject?
if let path = path {
	let descriptor = open(path, O_EVTONLY)
	guard descriptor >= 0 else { exit(3) }
	let watcher = DispatchSource.makeFileSystemObjectSource(
		fileDescriptor: descriptor, eventMask: [.write, .rename, .delete], queue: .main)
	watcher.setEventHandler {
		print("CHANGED")
		fflush(stdout)
	}
	watcher.setCancelHandler { close(descriptor) }
	watcher.resume()
	source = watcher
}
print("READY")
fflush(stdout)
RunLoop.current.run()

import AppKit
import ApplicationServices

// Subscribe before launch and report only a Calculator process transition.
let launched = CommandLine.arguments.count > 1 && CommandLine.arguments[1] == "launched"
let center = NSWorkspace.shared.notificationCenter
let name = launched ? NSWorkspace.didLaunchApplicationNotification : NSWorkspace.didTerminateApplicationNotification
let token = center.addObserver(forName: name, object: nil, queue: .main) { note in
	guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
		app.bundleIdentifier == "com.apple.calculator"
	else { return }
	print(app.processIdentifier)
	fflush(stdout)
	exit(0)
}
print("SUBSCRIBED")
fflush(stdout)
Timer.scheduledTimer(withTimeInterval: 10, repeats: false) { _ in exit(2) }
RunLoop.current.run()
center.removeObserver(token)

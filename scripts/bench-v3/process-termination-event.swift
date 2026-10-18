import AppKit

func targetArguments() -> (pid: Int32, bundle: String) {
	guard CommandLine.arguments.count == 3,
		let pid = Int32(CommandLine.arguments[1]), pid > 0
	else {
		fputs("Usage: process-termination-event PID BUNDLE\n", stderr)
		exit(1)
	}
	return (pid, CommandLine.arguments[2])
}
let target = targetArguments()
let app = NSRunningApplication(processIdentifier: target.pid)
if let app = app, app.bundleIdentifier != target.bundle {
	fputs("Owned process bundle mismatch\n", stderr)
	exit(1)
}
let center = NSWorkspace.shared.notificationCenter
let observer = center.addObserver(
	forName: NSWorkspace.didTerminateApplicationNotification, object: nil, queue: .main
) { note in
	guard let ended = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
		ended.processIdentifier == target.pid, ended.bundleIdentifier == target.bundle
	else { return }
	print(target.pid)
	fflush(stdout)
	exit(0)
}
print("SUBSCRIBED")
fflush(stdout)
if app == nil {
	print(target.pid)
	fflush(stdout)
	exit(0)
}
Timer.scheduledTimer(withTimeInterval: 10, repeats: false) { _ in exit(2) }
RunLoop.current.run()
center.removeObserver(observer)

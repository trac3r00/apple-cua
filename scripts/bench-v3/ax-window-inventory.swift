import AppKit
import ApplicationServices

@_silgen_name("_AXUIElementGetWindow")
func axWindowNumber(_ element: AXUIElement, _ number: UnsafeMutablePointer<UInt32>) -> AXError

guard CommandLine.arguments.count == 3, let pid = Int32(CommandLine.arguments[1]),
	let app = NSRunningApplication(processIdentifier: pid),
	app.bundleIdentifier == CommandLine.arguments[2]
else {
	fputs("Exact app identity missing or mismatched\n", stderr)
	exit(1)
}
let target = AXUIElementCreateApplication(pid)
AXUIElementSetMessagingTimeout(target, 2)
var value: CFTypeRef?
let status = AXUIElementCopyAttributeValue(target, kAXWindowsAttribute as CFString, &value)
guard status == .success, let windows = value as? [AXUIElement] else {
	fputs("AX window inventory unavailable: \(status.rawValue)\n", stderr)
	exit(1)
}
var ids: [UInt32] = []
for window in windows {
	var number: UInt32 = 0
	let result = axWindowNumber(window, &number)
	guard result == .success, number > 0 else {
		fputs("AX window number unavailable: \(result.rawValue)\n", stderr)
		exit(1)
	}
	ids.append(number)
}
let data = try JSONSerialization.data(withJSONObject: [
	"pid": pid, "bundle": app.bundleIdentifier ?? "", "ax_window_ids": ids,
])
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write("\n".data(using: .utf8)!)

import AppKit
import ApplicationServices
import Darwin
import Foundation

// Independent, listen-only evidence for TextEdit input and document value changes.
// All timestamps are Unix realtime nanoseconds; JS notification timestamps are millisecond-resolution.
func hostTimestampNs() -> Int64 {
	var value = timespec()
	clock_gettime(CLOCK_REALTIME, &value)
	return Int64(value.tv_sec) * 1_000_000_000 + Int64(value.tv_nsec)
}

func emit(_ value: [String: Any]) {
	guard let data = try? JSONSerialization.data(withJSONObject: value) else { return }
	FileHandle.standardOutput.write(data)
	FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

func stringValue(_ element: AXUIElement, _ attribute: CFString) -> String? {
	var value: CFTypeRef?
	guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success else { return nil }
	return value as? String
}

let pid = pid_t(CommandLine.arguments.count > 1 ? (Int32(CommandLine.arguments[1]) ?? -1) : -1)
guard pid > 0, CommandLine.arguments.count == 3 else {
	fputs("Usage: text-input-event.swift <TextEdit-pid> <owned-window-title>\n", stderr)
	exit(2)
}
let windowTitle = CommandLine.arguments[2]

let appElement = AXUIElementCreateApplication(pid)
var axObserver: AXObserver?
var valueObserverCount = 0
var events: [[String: Any]] = []
var subscribedElements = Set<CFHashCode>()

func recordValueChange(_ element: AXUIElement) {
	events.append([
		"kind": "ax-value-changed",
		"host_time_ns": String(hostTimestampNs()),
		"value": (stringValue(element, kAXValueAttribute as CFString) as Any?) ?? NSNull(),
		"role": stringValue(element, kAXRoleAttribute as CFString) ?? "",
	])
}

let axCallback: AXObserverCallback = { _, element, notification, _ in
	if notification as String == kAXValueChangedNotification {
		recordValueChange(element)
	}
}

func subscribeTextAreas(_ element: AXUIElement, depth: Int) {
	guard depth < 20 else { return }
	let hash = CFHash(element)
	guard !subscribedElements.contains(hash) else { return }
	subscribedElements.insert(hash)

	if stringValue(element, kAXRoleAttribute as CFString) == (kAXTextAreaRole as String) {
		let status = AXObserverAddNotification(
			axObserver!, element, kAXValueChangedNotification as CFString, nil)
		if status == .success {
			valueObserverCount += 1
		} else if status != .notificationAlreadyRegistered {
			return
		}
	}

	var children: CFTypeRef?
	guard
		AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children)
			== .success,
		let items = children as? [AXUIElement]
	else { return }
	for child in items { subscribeTextAreas(child, depth: depth + 1) }
}

guard AXObserverCreate(pid, axCallback, &axObserver) == .success, let axObserver else {
	fputs("AX observer creation failed\n", stderr)
	exit(3)
}
CFRunLoopAddSource(CFRunLoopGetCurrent(), AXObserverGetRunLoopSource(axObserver), .defaultMode)
var windowValues: CFTypeRef?
guard
	AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute as CFString, &windowValues)
		== .success,
	let windows = windowValues as? [AXUIElement]
else { exit(4) }
let owned = windows.filter { stringValue($0, kAXTitleAttribute as CFString) == windowTitle }
guard owned.count == 1 else {
	fputs("Owned window title is missing or ambiguous\n", stderr)
	exit(4)
}
subscribeTextAreas(owned[0], depth: 0)
guard valueObserverCount > 0 else {
	fputs("No TextEdit AX text-area value observer could be registered\n", stderr)
	exit(5)
}

let observer = axObserver
let stream = FileHandle.standardInput
DispatchQueue.global().async {
	while let line = try? stream.read(upToCount: 4096), !line.isEmpty {
		if String(decoding: line, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
			== "stop"
		{
			DispatchQueue.main.async {
				CFRunLoopRemoveSource(
					CFRunLoopGetCurrent(), AXObserverGetRunLoopSource(observer), .defaultMode)
				for event in events { emit(event) }
				emit([
					"summary": [
						"event_count": events.count, "ax_observer_count": valueObserverCount,
					]
				])
				exit(0)
			}
			break
		}
	}
}

emit([
	"ready": true,
	"ax_observer_count": valueObserverCount,
	"host_time_ns": String(hostTimestampNs()),
])
RunLoop.current.run()

import AppKit
import CoreGraphics
import Foundation

// Measurement only: observes app activations and samples the hardware cursor until stdin says "stop"
// (or closes), then prints one JSON summary line. Never posts input or activates anything.

func emit(_ value: [String: Any]) {
	if let data = try? JSONSerialization.data(withJSONObject: value) {
		FileHandle.standardOutput.write(data)
		FileHandle.standardOutput.write("\n".data(using: .utf8)!)
	}
}

let started = Date()
let startFront = NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? ""
let startCursor = CGEvent(source: nil)?.location ?? .zero
var activations: [[String: Any]] = []
var maxCursorDistance = 0.0
var cursorSamples = 0
var cursorChanges: [[String: Any]] = []
var previousCursor = startCursor
let primaryTop = NSScreen.screens.first?.frame.maxY ?? 0
func appKitCursor() -> CGPoint {
	let point = NSEvent.mouseLocation
	return CGPoint(x: point.x, y: primaryTop - point.y)
}
let startAppKitCursor = appKitCursor()
var maxAppKitCursorDistance = 0.0
var maxCursorApiDifference = 0.0
var pointerDisturbanceReported = false
var pointerEvents: [[String: Any]] = []
// Only use already-granted event-listening access. Never request a permission
// or intercept keys. Source metadata describes an event, not causal attribution.
let listenAccess = CGPreflightListenEventAccess()
let mouseMask = [CGEventType.mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged]
	.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
let pointerTap: CFMachPort? =
	listenAccess
	? CGEvent.tapCreate(
		tap: .cgSessionEventTap, place: .tailAppendEventTap, options: .listenOnly,
		eventsOfInterest: mouseMask,
		callback: { _, type, event, _ in
			if type != .tapDisabledByTimeout && type != .tapDisabledByUserInput
				&& pointerEvents.count < 1000
			{
				pointerEvents.append([
					"epoch_ms": Int(Date().timeIntervalSince1970 * 1000),
					"x": event.location.x, "y": event.location.y,
					"source_pid": event.getIntegerValueField(.eventSourceUnixProcessID),
					"source_bundle": NSRunningApplication(
						processIdentifier: pid_t(
							event.getIntegerValueField(.eventSourceUnixProcessID))
					)?.bundleIdentifier ?? "",
					"source_state_id": event.getIntegerValueField(.eventSourceStateID),
					"type": type.rawValue,
				])
			}
			return Unmanaged.passUnretained(event)
		}, userInfo: nil
	) : nil
if let tap = pointerTap, let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) {
	CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
}

let observer = NSWorkspace.shared.notificationCenter.addObserver(
	forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
) { note in
	let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
	let activation: [String: Any] = [
		"ms": Int(Date().timeIntervalSince(started) * 1000),
		"bundle": app?.bundleIdentifier ?? "",
	]
	activations.append(activation)
	emit([
		"disturbance": [
			"kind": "activation", "ms": activation["ms"]!, "bundle": activation["bundle"]!,
		]
	])
}

let sampler = Timer(timeInterval: 0.05, repeats: true) { _ in
	guard let point = CGEvent(source: nil)?.location else { return }
	cursorSamples += 1
	let independent = appKitCursor()
	maxAppKitCursorDistance = max(
		maxAppKitCursorDistance,
		hypot(independent.x - startAppKitCursor.x, independent.y - startAppKitCursor.y))
	maxCursorApiDifference = max(
		maxCursorApiDifference, hypot(independent.x - point.x, independent.y - point.y))
	if hypot(point.x - previousCursor.x, point.y - previousCursor.y) > 2 {
		if cursorChanges.count < 1000 {
			cursorChanges.append([
				"epoch_ms": Int(Date().timeIntervalSince1970 * 1000),
				"x": point.x, "y": point.y,
				"appkit_x": independent.x, "appkit_y": independent.y,
			])
		}
		previousCursor = point
	}
	maxCursorDistance = max(
		maxCursorDistance, hypot(point.x - startCursor.x, point.y - startCursor.y))
	if !pointerDisturbanceReported && max(maxCursorDistance, maxAppKitCursorDistance) > 2 {
		pointerDisturbanceReported = true
		emit([
			"disturbance": [
				"kind": "pointer", "ms": Int(Date().timeIntervalSince(started) * 1000),
				"max_cursor_px": maxCursorDistance, "max_appkit_cursor_px": maxAppKitCursorDistance,
			]
		])
	}
}
RunLoop.main.add(sampler, forMode: .common)

func finish() {
	sampler.invalidate()
	if let tap = pointerTap { CFMachPortInvalidate(tap) }
	NSWorkspace.shared.notificationCenter.removeObserver(observer)
	let endCursor = CGEvent(source: nil)?.location ?? .zero
	emit([
		"summary": [
			"duration_ms": Int(Date().timeIntervalSince(started) * 1000),
			"front_start": startFront,
			"front_end": NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "",
			"activations": activations,
			"cursor_samples": cursorSamples,
			"max_cursor_px": maxCursorDistance,
			"max_appkit_cursor_px": maxAppKitCursorDistance,
			"max_cursor_api_difference_px": maxCursorApiDifference,
			"end_cursor_px": hypot(endCursor.x - startCursor.x, endCursor.y - startCursor.y),
			"cursor_changes": cursorChanges,
			"pointer_event_listen_access": listenAccess,
			"pointer_event_tap_available": pointerTap != nil,
			"pointer_events": pointerEvents,
			"start_cursor": ["x": startCursor.x, "y": startCursor.y],
			"end_cursor": ["x": endCursor.x, "y": endCursor.y],
		] as [String: Any]
	])
	exit(0)
}

DispatchQueue.global().async {
	while let line = readLine() {
		if line.trimmingCharacters(in: .whitespaces) == "stop" { break }
	}
	DispatchQueue.main.async { finish() }
}

DispatchQueue.main.async { emit(["ready": true]) }
RunLoop.main.run()

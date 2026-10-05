import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

func output(_ value: Any) {
    do {
        FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: value))
    } catch {
        fputs("Desktop state failed: \(error)\n", stderr)
        exit(1)
    }
}

func windows() -> [[String: Any]] {
    let entries = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    return entries.compactMap { entry in
        guard let pid = entry[kCGWindowOwnerPID as String] as? Int,
              let number = entry[kCGWindowNumber as String] as? Int,
              let layer = entry[kCGWindowLayer as String] as? Int,
              layer == 0 else { return nil }
        return ["pid": pid, "number": number, "title": entry[kCGWindowName as String] as? String ?? "",
                "owner": entry[kCGWindowOwnerName as String] as? String ?? "",
                "onScreen": entry[kCGWindowIsOnscreen as String] as? Bool ?? false]
    }
}

switch CommandLine.arguments.dropFirst().first ?? "read" {
case "read":
    let name = NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? ""
    guard let point = CGEvent(source: nil)?.location else {
        fputs("Unable to read hardware cursor\n", stderr)
        exit(1)
    }
    output(["app": name, "x": point.x, "y": point.y])
case "snapshot":
    output(["apps": NSWorkspace.shared.runningApplications.compactMap { app -> [String: Any]? in
        guard let bundle = app.bundleIdentifier else { return nil }
        return ["bundle": bundle, "pid": Int(app.processIdentifier)]
    }, "windows": windows()])
case "check", "close":
    guard CommandLine.arguments.count == 4,
          let pid = Int32(CommandLine.arguments[2]) else {
        fputs("Usage: desktop-state close <pid> <title>\n", stderr)
        exit(2)
    }
    let title = CommandLine.arguments[3]
    let app = AXUIElementCreateApplication(pid)
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &value) == .success,
          let elements = value as? [AXUIElement] else {
        fputs("Cannot inspect target windows\n", stderr)
        exit(1)
    }
    let matches = elements.filter { element in
        var current: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, kAXTitleAttribute as CFString, &current) == .success &&
            (current as? String) == title
    }
    guard matches.count == 1 else {
        fputs("Target window title is absent or ambiguous\n", stderr)
        exit(1)
    }
    if CommandLine.arguments[1] == "check" {
        output(["unique": true])
        exit(0)
    }
    var focused: CFTypeRef?
    guard AXUIElementPerformAction(matches[0], kAXRaiseAction as CFString) == .success,
          AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &focused) == .success,
          let focusedWindow = focused,
          CFEqual(focusedWindow, matches[0]),
          let down = CGEvent(keyboardEventSource: nil, virtualKey: 13, keyDown: true),
          let up = CGEvent(keyboardEventSource: nil, virtualKey: 13, keyDown: false) else {
        fputs("Target window absent, ambiguous or cannot be raised\n", stderr)
        exit(1)
    }
    down.flags = .maskCommand
    up.flags = .maskCommand
    down.postToPid(pid)
    up.postToPid(pid)
    output(["posted": true])
default:
    fputs("Unknown desktop-state mode\n", stderr)
    exit(2)
}

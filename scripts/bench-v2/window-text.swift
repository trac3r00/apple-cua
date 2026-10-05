// Prints the text Vision recognizes in an app's largest on-screen window, one line per string.
// The benchmark reads windows this way so an oracle never depends on what a driver reported.
// With a title, only windows whose title contains it count, so another document cannot answer.
// Usage: swift window-text.swift "<owner name>" ["<title substring>"]
import CoreGraphics
import Foundation
import Vision

guard [2, 3].contains(CommandLine.arguments.count) else {
	FileHandle.standardError.write("usage: window-text.swift <owner name> [<title substring>]\n".data(using: .utf8)!)
	exit(2)
}
let owner = CommandLine.arguments[1]
let title = CommandLine.arguments.count == 3 ? CommandLine.arguments[2] : nil
let windows =
	CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
	as? [[String: Any]] ?? []
let candidates = windows.filter {
	($0[kCGWindowOwnerName as String] as? String) == owner
		&& ($0[kCGWindowLayer as String] as? Int) == 0
		&& (title == nil || (($0[kCGWindowName as String] as? String) ?? "").contains(title!))
}
func area(_ window: [String: Any]) -> Double {
	let bounds = window[kCGWindowBounds as String] as? [String: Double] ?? [:]
	return (bounds["Width"] ?? 0) * (bounds["Height"] ?? 0)
}
guard let target = candidates.max(by: { area($0) < area($1) }),
	let number = target[kCGWindowNumber as String] as? Int
else {
	FileHandle.standardError.write("no on-screen window for \(owner)\n".data(using: .utf8)!)
	exit(1)
}
let path = NSTemporaryDirectory() + "window-text-\(number).png"
let capture = Process()
capture.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
capture.arguments = ["-x", "-o", "-l", String(number), path]
try capture.run()
capture.waitUntilExit()
defer { try? FileManager.default.removeItem(atPath: path) }
guard capture.terminationStatus == 0 else {
	FileHandle.standardError.write(
		"screencapture failed for window \(number)\n".data(using: .utf8)!)
	exit(1)
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
try VNImageRequestHandler(url: URL(fileURLWithPath: path)).perform([request])
for observation in request.results ?? [] {
	if let text = observation.topCandidates(1).first?.string {
		print(text)
	}
}

import AppKit
import ApplicationServices

// Observation only. AXDocument cannot prove ownership of unsaved documents.
@_silgen_name("_AXUIElementGetWindow")
func axWindowNumber(_ element: AXUIElement, _ number: UnsafeMutablePointer<UInt32>) -> AXError

var output: [String: Any] = [
	"matched_window_ids": [UInt32](),
	"unknown_document_windows": 0,
]

func finish(_ status: String, _ code: Int32, axError: AXError? = nil) -> Never {
	output["status"] = status
	if let axError = axError { output["ax_error"] = axError.rawValue }
	do {
		let data = try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
		FileHandle.standardOutput.write(data)
		FileHandle.standardOutput.write(Data([10]))
	} catch {
		fputs("JSON serialization failed\n", stderr)
		exit(1)
	}
	exit(code)
}

// Lexical normalization keeps closure checks possible after the file is removed.
// Normalize macOS's /tmp alias explicitly; no existence check or document read.
func canonicalPath(_ path: String) -> String? {
	guard path.hasPrefix("/") else { return nil }
	let standardized = URL(fileURLWithPath: path).standardizedFileURL.path
	if standardized == "/tmp" { return "/private/tmp" }
	if standardized.hasPrefix("/tmp/") { return "/private\(standardized)" }
	return standardized
}

func documentPath(_ value: CFTypeRef) -> String? {
	if let url = value as? URL {
		guard url.isFileURL, url.host == nil || url.host == "" || url.host == "localhost" else { return nil }
		return canonicalPath(url.path)
	}
	guard let text = value as? String else { return nil }
	if text.hasPrefix("/") { return canonicalPath(text) }
	guard let url = URL(string: text), url.isFileURL,
		url.host == nil || url.host == "" || url.host == "localhost"
	else { return nil }
	return canonicalPath(url.path)
}

guard CommandLine.arguments.count == 4 else { finish("invalid_arguments", 1) }
guard let pid = Int32(CommandLine.arguments[1]), pid > 0 else { finish("invalid_pid", 1) }
let bundle = CommandLine.arguments[2]
output["pid"] = pid
output["bundle"] = bundle
guard let requestedPath = canonicalPath(CommandLine.arguments[3]),
	requestedPath.hasPrefix("/private/tmp/cua-bench/")
else { finish("invalid_owned_file_path", 1) }
guard let app = NSRunningApplication(processIdentifier: pid),
	app.bundleIdentifier == bundle
else { finish("app_identity_mismatch", 1) }

let target = AXUIElementCreateApplication(pid)
let timeoutStatus = AXUIElementSetMessagingTimeout(target, 2)
guard timeoutStatus == .success else { finish("ax_timeout_setup_failed", 1, axError: timeoutStatus) }
var windowsValue: CFTypeRef?
let windowsStatus = AXUIElementCopyAttributeValue(target, kAXWindowsAttribute as CFString, &windowsValue)
guard windowsStatus == .success else { finish("ax_windows_failed", 1, axError: windowsStatus) }
guard let windows = windowsValue as? [AXUIElement] else { finish("ax_windows_wrong_type", 1) }

var matches: [UInt32] = []
var unknown = 0
for window in windows {
	var documentValue: CFTypeRef?
	let documentStatus = AXUIElementCopyAttributeValue(window, kAXDocumentAttribute as CFString, &documentValue)
	if documentStatus == .attributeUnsupported || documentStatus == .noValue {
		unknown += 1
		output["unknown_document_windows"] = unknown
		continue
	}
	guard documentStatus == .success else { finish("ax_document_failed", 1, axError: documentStatus) }
	guard let value = documentValue, value is String || value is URL else {
		finish("ax_document_wrong_type", 1)
	}
	// A valid string/URL for a different document is not an ownership match.
	guard documentPath(value) == requestedPath else { continue }
	var number: UInt32 = 0
	let numberStatus = axWindowNumber(window, &number)
	guard numberStatus == .success else { finish("ax_window_number_failed", 1, axError: numberStatus) }
	guard number > 0 else { finish("ax_window_number_invalid", 1) }
	matches.append(number)
	output["matched_window_ids"] = matches
}
if matches.count > 1 { finish("ambiguous_match", 1) }
finish(matches.isEmpty ? "no_match" : "matched", 0)

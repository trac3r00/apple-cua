import AppKit
import ApplicationServices
import Darwin
import Foundation

// Read-only TextEdit mutation observer for cancellation benchmark evidence.
// Resolves exactly one TextEdit window whose AXDocument canonical path equals the owned document, finds exactly
// one AXTextArea inside it (bounded traversal), subscribes to that text area's AXValueChanged, and only then
// prints the ready line. It reads only the owned text area's AXValue; other windows contribute only their
// AXDocument path. No input, focus, pointer, activation, polling or accessibility actions.
//
// usage: cancellation-events <owned-document-path> [timeout-seconds]
//        cancellation-events --evaluate    (resolution Snapshot JSON on stdin; pure decision logic, no AX)
//        cancellation-events --commands    (stdin lines -> parsed command JSON lines; no AX)
//
// stdout is newline-delimited JSON, schema "cancellation-events-v1". Event types:
//   refused   no events follow; resolution/trust/subscription refused (status + reason, process exits non-zero)
//   ready     subscription is live; value = initial full text; epoch_ms/monotonic_ns at read time
//   change    AXValueChanged; value = full text re-read after the notification; epoch_ms/monotonic_ns are taken
//             when the notification was received, before the AX read
//   snapshot  answer to stdin "snapshot" (fresh read); final=true on the read made by "stop"/stdin EOF
//   end       always the last line: status ok | deadline | unavailable, reason, exit_code
// epoch_ms is Date.now()-comparable; monotonic_ns is CLOCK_UPTIME_RAW (mach_absolute_time) in nanoseconds.
// stdin commands: "snapshot", "stop". stdin EOF behaves like "stop".
//
// exit: 0 stopped ok, 2 usage, 3 unavailable/untrusted/unreadable, 4 missing or ambiguous window/text area,
//       5 deadline reached (timeout is a failure, never success)

struct Snapshot: Codable {
	let expected_path: String
	let process_count: Int
	let window_matches: Int
	let text_area_count: Int
	let truncated: Bool
	let error: String?
}

struct Event: Codable {
	let schema: String
	let type: String
	var seq: Int? = nil
	var epoch_ms: Int64? = nil
	var monotonic_ns: Int64? = nil
	var value: String? = nil
	var final: Bool? = nil
	var path: String? = nil
	var pid: Int32? = nil
	var timeout_s: Double? = nil
	var status: String? = nil
	var reason: String? = nil
	var exit_code: Int32? = nil
	var command: String? = nil
}

struct Verdict {
	let status: String
	let reason: String?
	let path: String?
	let code: Int32
}

let schemaName = "cancellation-events-v1"
let maxNodes = 3000
let maxDepth = 16
let defaultTimeout = 60.0
let maxTimeout = 600.0
let maxCommandBytes = 4096

let encoder: JSONEncoder = {
	let encoder = JSONEncoder()
	encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
	return encoder
}()

func emitLine(_ event: Event) {
	guard let data = try? encoder.encode(event) else { return }
	FileHandle.standardOutput.write(data + Data("\n".utf8))
}

func nowEpochMs() -> Int64 { return Int64((Date().timeIntervalSince1970 * 1000).rounded()) }
func nowMonotonicNs() -> Int64 { return Int64(clock_gettime_nsec_np(CLOCK_UPTIME_RAW)) }

func realPath(_ path: String) -> String? {
	guard let resolved = realpath(path, nil) else { return nil }
	defer { free(resolved) }
	return String(cString: resolved)
}

func isRegularFile(_ path: String) -> Bool {
	var info = stat()
	return stat(path, &info) == 0 && (info.st_mode & S_IFMT) == S_IFREG
}

func fileURLPath(_ text: String) -> String? {
	guard let url = URL(string: text), url.isFileURL else { return nil }
	return url.path
}

func parseCommand(_ line: String) -> String? {
	let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
	return trimmed == "snapshot" || trimmed == "stop" ? trimmed : nil
}

func decide(_ snapshot: Snapshot) -> Verdict {
	func fail(_ status: String, _ reason: String, _ code: Int32, _ path: String? = nil) -> Verdict {
		return Verdict(status: status, reason: reason, path: path, code: code)
	}
	if let error = snapshot.error { return fail("unavailable", error, 3) }
	guard let expected = realPath(snapshot.expected_path), isRegularFile(expected) else {
		return fail("unavailable", "owned document is not an existing regular file", 3)
	}
	if snapshot.process_count == 0 { return fail("unavailable", "TextEdit is not running", 3, expected) }
	if snapshot.process_count > 1 {
		return fail("ambiguous-process", "multiple TextEdit processes are running", 4, expected)
	}
	if snapshot.window_matches == 0 {
		return fail("missing-window", "no TextEdit window has the owned AXDocument path", 4, expected)
	}
	if snapshot.window_matches > 1 {
		return fail("ambiguous-window", "multiple TextEdit windows have the owned AXDocument path", 4, expected)
	}
	if snapshot.truncated { return fail("unavailable", "AX traversal bound reached", 3, expected) }
	if snapshot.text_area_count == 0 {
		return fail("missing-text-area", "owned window has no AXTextArea", 4, expected)
	}
	if snapshot.text_area_count > 1 {
		return fail("ambiguous-text-area", "owned window has more than one AXTextArea", 4, expected)
	}
	return Verdict(status: "ok", reason: nil, path: expected, code: 0)
}

func refuse(_ verdict: Verdict) -> Never {
	emitLine(
		Event(
			schema: schemaName, type: "refused", path: verdict.path, status: verdict.status,
			reason: verdict.reason, exit_code: verdict.code))
	exit(verdict.code)
}

// MARK: AX reads

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
	var value: CFTypeRef?
	return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success
		? value : nil
}

func role(_ element: AXUIElement) -> String? {
	return attribute(element, kAXRoleAttribute) as? String
}

func documentPath(_ window: AXUIElement) -> String? {
	guard let value = attribute(window, "AXDocument") else { return nil }
	let text = (value as? URL)?.absoluteString ?? (value as? String)
	guard let text = text, let path = fileURLPath(text), let canonical = realPath(path) else {
		return nil
	}
	return canonical
}

func readValue(_ element: AXUIElement) -> String? {
	return attribute(element, kAXValueAttribute) as? String
}

struct Resolution {
	let snapshot: Snapshot
	let pid: pid_t?
	let textArea: AXUIElement?
}

func resolve(expectedPath: String) -> Resolution {
	func result(
		processes: Int = 0, matches: Int = 0, areas: Int = 0, truncated: Bool = false,
		error: String? = nil, pid: pid_t? = nil, textArea: AXUIElement? = nil
	) -> Resolution {
		return Resolution(
			snapshot: Snapshot(
				expected_path: expectedPath, process_count: processes, window_matches: matches,
				text_area_count: areas, truncated: truncated, error: error), pid: pid,
			textArea: textArea)
	}
	guard AXIsProcessTrusted() else {
		return result(error: "accessibility is not trusted for this process")
	}
	guard let expected = realPath(expectedPath) else { return result() }
	let apps = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.TextEdit")
	guard apps.count == 1, let app = apps.first else { return result(processes: apps.count) }
	let application = AXUIElementCreateApplication(app.processIdentifier)
	AXUIElementSetMessagingTimeout(application, 2)
	var windowsValue: CFTypeRef?
	let status = AXUIElementCopyAttributeValue(
		application, kAXWindowsAttribute as CFString, &windowsValue)
	guard status == .success, let windows = windowsValue as? [AXUIElement] else {
		return result(
			processes: 1, error: "TextEdit AXWindows unreadable: AXError \(status.rawValue)")
	}
	let matching = windows.filter { documentPath($0) == expected }
	guard matching.count == 1, let window = matching.first else {
		return result(processes: 1, matches: matching.count)
	}
	var areas: [AXUIElement] = []
	var nodes = 0
	var truncated = false
	var stack: [(AXUIElement, Int)] = [(window, 0)]
	while let (element, depth) = stack.popLast() {
		nodes += 1
		if nodes > maxNodes || depth > maxDepth {
			truncated = true
			break
		}
		if role(element) == "AXTextArea" {
			areas.append(element)
			continue
		}
		for child in (attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? []).reversed() {
			stack.append((child, depth + 1))
		}
	}
	return result(
		processes: 1, matches: 1, areas: areas.count, truncated: truncated,
		pid: app.processIdentifier, textArea: areas.count == 1 ? areas[0] : nil)
}

// MARK: Observer session (single-threaded on the main run loop)

var sessionObserver: AXObserver?
var sessionTextArea: AXUIElement?
var sessionPath = ""
var sessionSeq = 0
var stdinSource: DispatchSourceRead?
var deadlineSource: DispatchSourceTimer?
var stdinBuffer = Data()
var finished = false

func nextSeq() -> Int {
	sessionSeq += 1
	return sessionSeq
}

func cleanup() {
	deadlineSource?.cancel()
	stdinSource?.cancel()
	if let observer = sessionObserver {
		if let area = sessionTextArea {
			AXObserverRemoveNotification(observer, area, kAXValueChangedNotification as CFString)
			AXObserverRemoveNotification(observer, area, kAXUIElementDestroyedNotification as CFString)
		}
		CFRunLoopRemoveSource(
			CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .defaultMode)
	}
	sessionObserver = nil
	sessionTextArea = nil
}

func finish(_ status: String, _ reason: String, _ code: Int32) -> Never {
	if !finished {
		finished = true
		cleanup()
		emitLine(
			Event(
				schema: schemaName, type: "end", epoch_ms: nowEpochMs(),
				monotonic_ns: nowMonotonicNs(), path: sessionPath, status: status, reason: reason,
				exit_code: code))
	}
	exit(code)
}

func emitRead(_ type: String, final: Bool? = nil, epoch: Int64? = nil, mono: Int64? = nil) {
	let epochMs = epoch ?? nowEpochMs()
	let monoNs = mono ?? nowMonotonicNs()
	guard let area = sessionTextArea, let value = readValue(area) else {
		finish("unavailable", "owned text area value unreadable", 3)
	}
	emitLine(
		Event(
			schema: schemaName, type: type, seq: nextSeq(), epoch_ms: epochMs, monotonic_ns: monoNs,
			value: value, final: final))
}

func handleCommand(_ command: String) {
	switch command {
	case "snapshot":
		emitRead("snapshot", final: false)
	default:
		emitRead("snapshot", final: true)
		finish("ok", "stop requested", 0)
	}
}

func drainStdin() {
	while let newline = stdinBuffer.firstIndex(of: 0x0A) {
		let line = String(decoding: stdinBuffer[stdinBuffer.startIndex..<newline], as: UTF8.self)
		stdinBuffer.removeSubrange(stdinBuffer.startIndex...newline)
		if let command = parseCommand(line) {
			handleCommand(command)
		} else if !line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
			emitLine(
				Event(
					schema: schemaName, type: "error", status: "unknown-command",
					reason: "expected snapshot or stop"))
		}
	}
	if stdinBuffer.count > maxCommandBytes {
		finish("unavailable", "stdin command exceeds \(maxCommandBytes) bytes", 3)
	}
}

let observerCallback: AXObserverCallback = { _, item, notification, _ in
	let epoch = nowEpochMs()
	let mono = nowMonotonicNs()
	guard let area = sessionTextArea, CFEqual(area, item) else { return }
	if notification as String == kAXUIElementDestroyedNotification {
		finish("unavailable", "owned text area was destroyed", 3)
	}
	if notification as String == kAXValueChangedNotification {
		emitRead("change", epoch: epoch, mono: mono)
	}
}

func parseTimeout(_ text: String?) -> Double? {
	guard let text = text else { return defaultTimeout }
	guard let seconds = Double(text), seconds.isFinite, seconds > 0, seconds <= maxTimeout else {
		return nil
	}
	return seconds
}

func runObserver(path: String, timeout: Double) -> Never {
	guard isRegularFile(path), let canonical = realPath(path) else {
		refuse(
			Verdict(
				status: "unavailable", reason: "owned document is not an existing regular file",
				path: nil, code: 3))
	}
	sessionPath = canonical
	let resolution = resolve(expectedPath: canonical)
	let verdict = decide(resolution.snapshot)
	guard verdict.code == 0, let pid = resolution.pid, let area = resolution.textArea else {
		refuse(verdict.code == 0 ? Verdict(status: "unavailable", reason: "no text area", path: canonical, code: 3) : verdict)
	}
	AXUIElementSetMessagingTimeout(area, 2)
	var created: AXObserver?
	guard AXObserverCreate(pid, observerCallback, &created) == .success, let observer = created else {
		refuse(
			Verdict(status: "unavailable", reason: "AXObserver creation failed", path: canonical, code: 3))
	}
	sessionObserver = observer
	sessionTextArea = area
	CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .defaultMode)
	let registration = AXObserverAddNotification(
		observer, area, kAXValueChangedNotification as CFString, nil)
	guard registration == .success else {
		cleanup()
		refuse(
			Verdict(
				status: "unavailable",
				reason: "AXValueChanged registration failed: AXError \(registration.rawValue)",
				path: canonical, code: 3))
	}
	// Best effort: lets the observer end cleanly instead of waiting for the deadline if the area goes away.
	AXObserverAddNotification(observer, area, kAXUIElementDestroyedNotification as CFString, nil)

	// The subscription is live; any change after this point is queued behind the ready line.
	guard let initial = readValue(area) else {
		cleanup()
		refuse(
			Verdict(
				status: "unavailable", reason: "owned text area value unreadable", path: canonical,
				code: 3))
	}
	emitLine(
		Event(
			schema: schemaName, type: "ready", seq: 0, epoch_ms: nowEpochMs(),
			monotonic_ns: nowMonotonicNs(), value: initial, path: canonical, pid: pid,
			timeout_s: timeout))

	let timer = DispatchSource.makeTimerSource(queue: .main)
	timer.schedule(deadline: .now() + timeout)
	timer.setEventHandler { finish("deadline", "timeout of \(timeout)s reached", 5) }
	timer.resume()
	deadlineSource = timer

	let source = DispatchSource.makeReadSource(fileDescriptor: STDIN_FILENO, queue: .main)
	source.setEventHandler {
		var chunk = [UInt8](repeating: 0, count: 1024)
		let count = read(STDIN_FILENO, &chunk, chunk.count)
		if count == 0 {
			emitRead("snapshot", final: true)
			finish("ok", "stdin closed", 0)
		}
		if count < 0 {
			if errno == EAGAIN || errno == EINTR { return }
			finish("unavailable", "stdin read failed: errno \(errno)", 3)
		}
		stdinBuffer.append(contentsOf: chunk[0..<count])
		drainStdin()
	}
	source.resume()
	stdinSource = source
	RunLoop.main.run()
	finish("unavailable", "run loop exited unexpectedly", 3)
}

// MARK: Entry

let arguments = CommandLine.arguments
if arguments.count == 2, arguments[1] == "--evaluate" {
	guard
		let snapshot = try? JSONDecoder().decode(
			Snapshot.self, from: FileHandle.standardInput.readDataToEndOfFile())
	else {
		fputs("invalid snapshot JSON\n", stderr)
		exit(2)
	}
	let verdict = decide(snapshot)
	if verdict.code != 0 { refuse(verdict) }
	emitLine(Event(schema: schemaName, type: "resolved", path: verdict.path, status: "ok"))
	exit(0)
}
if arguments.count == 2, arguments[1] == "--commands" {
	let input = String(decoding: FileHandle.standardInput.readDataToEndOfFile(), as: UTF8.self)
	// Same framing as the live stdin reader: split on LF only, blank lines ignored.
	for line in input.components(separatedBy: "\n")
	where !line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
		emitLine(Event(schema: schemaName, type: "command", command: parseCommand(line) ?? "unknown"))
	}
	exit(0)
}
guard arguments.count == 2 || arguments.count == 3, !arguments[1].isEmpty,
	let timeout = parseTimeout(arguments.count == 3 ? arguments[2] : nil)
else {
	fputs(
		"usage: cancellation-events <owned-document-path> [timeout-seconds (0, \(Int(maxTimeout))]]\n",
		stderr)
	exit(2)
}
runObserver(path: arguments[1], timeout: timeout)

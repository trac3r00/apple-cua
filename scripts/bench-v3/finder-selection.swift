import AppKit
import ApplicationServices
import Darwin
import Foundation

// Read-only Finder selection oracle. Resolves exactly one owned Finder window by exact title, verifies its
// AXDocument directory equals the owned directory, then enumerates the window's selected rows/children and
// resolves each to a path through AXURL or a name that exists inside the verified directory.
// No input, focus, pointer, timers, polling or accessibility actions.
//
// usage: finder-selection <window-title> <owned-dir>
//        finder-selection --evaluate        (Snapshot JSON on stdin; pure decision logic, no AX)
// exit:  0 ok, 2 usage, 3 unavailable, 4 missing/ambiguous window, 5 ambiguous selection, 6 empty selection

struct NameCandidate: Codable {
	let source: String
	let value: String
}

struct Candidate: Codable {
	let container: Int
	let provenance: String
	let url: String?
	let names: [NameCandidate]
}

struct Snapshot: Codable {
	let title: String
	let expected_dir: String
	let window_matches: Int
	let window_document: String?
	let window_target: String?
	let candidates: [Candidate]
	let truncated: Bool
	let error: String?
}

struct Selected: Codable {
	let path: String
	let provenance: String
	let method: String
}

struct Verdict: Codable {
	let status: String
	let reason: String?
	let window_dir: String?
	let selected: [Selected]
}

struct Report: Codable {
	let schema: String
	let verdict: Verdict
	let snapshot: Snapshot
}

let maxNodes = 3000
let maxDepth = 16
let maxCandidates = 50
let maxText = 512

func realPath(_ path: String) -> String? {
	guard let resolved = realpath(path, nil) else { return nil }
	defer { free(resolved) }
	return String(cString: resolved)
}

func fileURLPath(_ text: String) -> String? {
	guard let url = URL(string: text), url.isFileURL else { return nil }
	return url.path
}

// Symlink-safe: canonicalize the parent directory, require the entry itself to exist (lstat).
func canonicalEntry(_ path: String) -> String? {
	let node = path as NSString
	let name = node.lastPathComponent
	guard !name.isEmpty, name != ".", name != "..",
		let parent = realPath(node.deletingLastPathComponent)
	else {
		return nil
	}
	var info = stat()
	guard lstat(path, &info) == 0 else { return nil }
	return parent == "/" ? "/" + name : parent + "/" + name
}

func decide(_ snapshot: Snapshot) -> (Verdict, Int32) {
	func fail(_ status: String, _ reason: String, _ code: Int32, _ dir: String? = nil) -> (
		Verdict, Int32
	) {
		return (Verdict(status: status, reason: reason, window_dir: dir, selected: []), code)
	}
	if let error = snapshot.error { return fail("unavailable", error, 3) }
	guard let expected = realPath(snapshot.expected_dir) else {
		return fail("unavailable", "owned directory does not exist", 3)
	}
	if snapshot.window_matches == 0 {
		return fail("missing-window", "no Finder window has the exact title", 4)
	}
	if snapshot.window_matches > 1 {
		return fail("ambiguous-window", "multiple Finder windows share the title", 4)
	}
	guard let document = snapshot.window_document ?? snapshot.window_target,
		let documentPath = fileURLPath(document),
		let windowDir = realPath(documentPath)
	else { return fail("unavailable", "window AXDocument directory not readable", 3) }
	guard windowDir == expected else {
		return fail("unavailable", "window directory does not match owned directory", 3, windowDir)
	}
	if snapshot.truncated { return fail("unavailable", "AX traversal bound reached", 3, windowDir) }
	if snapshot.candidates.isEmpty {
		return fail("empty", "no selected rows or items in window", 6, windowDir)
	}
	if Set(snapshot.candidates.map { $0.container }).count > 1 {
		return fail("ambiguous", "selection found in more than one container", 5, windowDir)
	}
	var selected: [Selected] = []
	for candidate in snapshot.candidates {
		var resolved: Selected?
		if let url = candidate.url {
			guard let path = fileURLPath(url), let canonical = canonicalEntry(path) else {
				return fail(
					"unavailable",
					"selected AXURL is not an existing file URL: \(candidate.provenance)", 3,
					windowDir)
			}
			resolved = Selected(path: canonical, provenance: candidate.provenance, method: "AXURL")
		} else {
			for name in candidate.names where !name.value.isEmpty && !name.value.contains("/") {
				if let canonical = canonicalEntry(windowDir + "/" + name.value) {
					resolved = Selected(
						path: canonical, provenance: candidate.provenance,
						method: "name:" + name.source)
					break
				}
			}
		}
		guard let item = resolved else {
			return fail(
				"unavailable",
				"selected item has no resolvable URL or name: \(candidate.provenance)", 3, windowDir
			)
		}
		guard item.path.hasPrefix(windowDir == "/" ? "/" : windowDir + "/") else {
			return fail(
				"unavailable", "selected item is outside window directory: \(candidate.provenance)",
				3, windowDir)
		}
		selected.append(item)
	}
	return (Verdict(status: "ok", reason: nil, window_dir: windowDir, selected: selected), 0)
}

// MARK: AX reads

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
	var value: CFTypeRef?
	return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success
		? value : nil
}

func text(_ element: AXUIElement, _ name: String) -> String? {
	guard let value = attribute(element, name) as? String else { return nil }
	return String(value.prefix(maxText))
}

func elements(_ element: AXUIElement, _ name: String) -> [AXUIElement] {
	return attribute(element, name) as? [AXUIElement] ?? []
}

func urlText(_ element: AXUIElement) -> String? {
	guard let value = attribute(element, "AXURL") else { return nil }
	if let url = value as? URL { return url.absoluteString }
	return (value as? String).map { String($0.prefix(maxText)) }
}

func isSidebar(_ element: AXUIElement) -> Bool {
	let marker =
		((text(element, "AXIdentifier") ?? "") + " " + (text(element, kAXSubroleAttribute) ?? ""))
		.lowercased()
	return marker.contains("sidebar")
}

func nameCandidates(_ element: AXUIElement) -> [NameCandidate] {
	var names: [NameCandidate] = []
	func add(_ source: String, _ value: String?) {
		if let value = value, !value.isEmpty {
			names.append(NameCandidate(source: source, value: value))
		}
	}
	add("AXFilename", text(element, "AXFilename"))
	add("AXTitle", text(element, kAXTitleAttribute))
	// First text-bearing descendant in document order is the name column of a list row.
	var stack: [(AXUIElement, Int)] = elements(element, kAXChildrenAttribute).reversed().map {
		($0, 1)
	}
	var visited = 0
	while let (child, depth) = stack.popLast(), visited < 40 {
		visited += 1
		let role = text(child, kAXRoleAttribute) ?? ""
		if role == "AXTextField" || role == "AXStaticText" {
			if let value = text(child, kAXValueAttribute), !value.isEmpty {
				add("descendant:\(role).AXValue", value)
				break
			}
		}
		if depth < 4 {
			stack.append(
				contentsOf: elements(child, kAXChildrenAttribute).reversed().map { ($0, depth + 1) }
			)
		}
	}
	add("AXDescription", text(element, kAXDescriptionAttribute))
	return names
}

func collect(title: String, expectedDir: String) -> Snapshot {
	func snapshot(
		matches: Int = 0, document: String? = nil, candidates: [Candidate] = [],
		truncated: Bool = false,
		error: String? = nil
	) -> Snapshot {
		return Snapshot(
			title: title, expected_dir: expectedDir, window_matches: matches,
			window_document: document,
			window_target: CommandLine.arguments.count == 4 ? CommandLine.arguments[3] : nil,
			candidates: candidates, truncated: truncated, error: error)
	}
	guard AXIsProcessTrusted() else {
		return snapshot(error: "accessibility is not trusted for this process")
	}
	guard
		let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.finder")
			.first
	else {
		return snapshot(error: "Finder is not running")
	}
	let application = AXUIElementCreateApplication(app.processIdentifier)
	AXUIElementSetMessagingTimeout(application, 2)
	var windowsValue: CFTypeRef?
	let status = AXUIElementCopyAttributeValue(
		application, kAXWindowsAttribute as CFString, &windowsValue)
	guard status == .success, let windows = windowsValue as? [AXUIElement] else {
		return snapshot(error: "Finder AXWindows unreadable: AXError \(status.rawValue)")
	}
	let matching = windows.filter { text($0, kAXTitleAttribute) == title }
	guard matching.count == 1, let window = matching.first else {
		return snapshot(matches: matching.count)
	}
	let document = text(window, "AXDocument")

	var candidates: [Candidate] = []
	var seen: [AXUIElement] = []
	var containers = 0
	var nodes = 0
	var truncated = false
	var stack: [(AXUIElement, Int, String)] = [(window, 0, "AXWindow")]
	while let (element, depth, path) = stack.popLast() {
		nodes += 1
		if nodes > maxNodes || depth > maxDepth {
			truncated = true
			break
		}
		if isSidebar(element) { continue }
		var selection = elements(element, "AXSelectedRows")
		var kind = "AXSelectedRows"
		if selection.isEmpty {
			selection = elements(element, "AXSelectedChildren")
			kind = "AXSelectedChildren"
		}
		var claimed = false
		for (index, item) in selection.enumerated()
		where !seen.contains(where: { CFEqual($0, item) }) {
			if candidates.count >= maxCandidates {
				truncated = true
				break
			}
			seen.append(item)
			claimed = true
			candidates.append(
				Candidate(
					container: containers, provenance: "\(path)/\(kind)[\(index)]",
					url: urlText(item),
					names: nameCandidates(item)))
		}
		if claimed { containers += 1 }
		let children = elements(element, kAXChildrenAttribute)
		for (index, child) in children.enumerated().reversed() {
			let role = text(child, kAXRoleAttribute) ?? "AXUnknown"
			stack.append((child, depth + 1, "\(path)/\(role)[\(index)]"))
		}
	}
	return snapshot(matches: 1, document: document, candidates: candidates, truncated: truncated)
}

func emit(_ snapshot: Snapshot) -> Never {
	let (verdict, code) = decide(snapshot)
	let encoder = JSONEncoder()
	encoder.outputFormatting = [.sortedKeys, .prettyPrinted, .withoutEscapingSlashes]
	let report = Report(schema: "finder-selection-v1", verdict: verdict, snapshot: snapshot)
	guard let data = try? encoder.encode(report) else { exit(2) }
	FileHandle.standardOutput.write(data)
	FileHandle.standardOutput.write(Data("\n".utf8))
	exit(code)
}

let arguments = CommandLine.arguments
if arguments.count == 2, arguments[1] == "--evaluate" {
	guard
		let snapshot = try? JSONDecoder().decode(
			Snapshot.self, from: FileHandle.standardInput.readDataToEndOfFile())
	else {
		fputs("invalid snapshot JSON\n", stderr)
		exit(2)
	}
	emit(snapshot)
}
guard arguments.count == 3 || arguments.count == 4, !arguments[1].isEmpty, !arguments[2].isEmpty
else {
	fputs("usage: finder-selection <window-title> <owned-dir>\n", stderr)
	exit(2)
}
// Refuse before touching AX when the owned directory cannot be verified.
if realPath(arguments[2]) == nil {
	emit(
		Snapshot(
			title: arguments[1], expected_dir: arguments[2], window_matches: 0,
			window_document: nil, window_target: nil, candidates: [],
			truncated: false, error: nil))
}
emit(collect(title: arguments[1], expectedDir: arguments[2]))

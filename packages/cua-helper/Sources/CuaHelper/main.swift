// MIT License
// SkyLight event-posting behavior is based on reverse-engineering notes from trycua's MIT-licensed cua-driver,
// reimplemented here for macos-cua's JSON-over-stdio helper.

import AppKit
import CoreGraphics
import Foundation

final class HelperServer {
	private let decoder = JSONDecoder()
	private let encoder = JSONEncoder()

	func run() async {
		_ = CGRequestScreenCaptureAccess()
		while let line = readLine() {
			guard !line.isEmpty else { continue }
			await handle(line)
		}
	}

	private func handle(_ line: String) async {
		let request: HelperRequest
		do {
			request = try decoder.decode(HelperRequest.self, from: Data(line.utf8))
		} catch {
			write(HelperResponse.failure(id: "", "invalid json: \(error)"))
			return
		}
		do {
			write(try await dispatch(request))
		} catch let error as HelperFailure {
			write(.failure(id: request.id, error.description))
		} catch let error as ScreenshotFailure {
			write(.failure(id: request.id, error.description))
		} catch let error as AccessibilityFailure {
			write(.failure(id: request.id, error.description))
		} catch {
			write(.failure(id: request.id, "unexpected error: \(error)"))
		}
	}

	private func dispatch(_ request: HelperRequest) async throws -> HelperResponse {
		switch request.cmd {
		case "ping": return .success(id: request.id, version: helperVersion)
		case "cursor_position":
			guard let event = CGEvent(source: nil) else { throw HelperFailure.eventCreation("cursor") }
			let point = event.location
			return .success(id: request.id, x: point.x, y: point.y)
		case "screen_size_logical":
			let frame = NSScreen.main?.frame ?? CGRect.zero
			return .success(id: request.id, x: Double(frame.width), y: Double(frame.height))
		case "click": try InputActions.click(pid: pid(request), point: point(request), button: button(request, fallback: .left), count: request.count ?? 1, modifiers: request.modifiers ?? [])
		case "right_click": try InputActions.click(pid: pid(request), point: point(request), button: .right, count: 1, modifiers: request.modifiers ?? [])
		case "middle_click": try InputActions.click(pid: pid(request), point: point(request), button: .middle, count: 1, modifiers: request.modifiers ?? [])
		case "double_click": try InputActions.click(pid: pid(request), point: point(request), button: .left, count: 2, modifiers: request.modifiers ?? [])
		case "move": try InputActions.move(pid: pid(request), point: point(request))
		case "drag": try InputActions.drag(pid: pid(request), from: fromPoint(request), to: toPoint(request), duration: request.duration ?? 500, steps: request.steps ?? defaultDragSteps, modifiers: request.modifiers ?? [])
		case "key": try InputActions.key(pid: pid(request), key: request.key, keyCode: request.keyCode, modifiers: request.modifiers ?? [])
		case "type_text": try InputActions.typeText(pid: pid(request), text: request.text ?? "")
		case "screenshot":
			let result = try await ScreenshotCapture.capture(width: screenshotWidth(request), height: screenshotHeight(request))
			return .success(id: request.id, data: result.data.base64EncodedString(), width: result.width, height: result.height)
		case "getAppState":
			return try await getAppState(request)
		case "listApps":
			return .success(id: request.id, apps: listApps())
		case "getAXTree":
			let targetPID = try pid(request)
			guard NSRunningApplication(processIdentifier: targetPID) != nil else {
				throw AccessibilityFailure.invalidProcess(targetPID)
			}
			let tree = AccessibilityTree.extract(pid: targetPID)
			return .success(id: request.id, axAvailable: tree.axAvailable, elements: tree.elements.map(AXElementJSON.init))
		case "performAction":
			guard let elementIndex = request.elementIndex else { throw HelperFailure.missing("elementIndex") }
			guard let action = request.action else { throw HelperFailure.missing("action") }
			try AccessibilityTree.performAction(pid: pid(request), elementIndex: elementIndex, action: action)
			return .success(id: request.id)
		case "setValue":
			guard let elementIndex = request.elementIndex else { throw HelperFailure.missing("elementIndex") }
			guard let value = request.targetValue else { throw HelperFailure.missing("targetValue") }
			try AccessibilityTree.setValue(pid: pid(request), elementIndex: elementIndex, value: value)
			return .success(id: request.id)
		case "scroll": throw HelperFailure.invalid("scroll is implemented in TypeScript via key events, not in cua-helper")
		case "waitForSettle":
			let settled = await UISettleDetector.waitForSettle(
				pid: request.pid ?? 0,
				timeoutMs: request.timeoutMs ?? 2000,
				settleMs: request.settleMs ?? 300,
				pollMs: request.pollMs ?? 50
			)
			return .success(id: request.id, settled: settled)
		default: throw HelperFailure.invalid("unsupported command: \(request.cmd)")
		}
		return .success(id: request.id)
	}

	private func getAppState(_ request: HelperRequest) async throws -> HelperResponse {
		let targetPID = try appStatePID(request)
		guard let runningApp = NSRunningApplication(processIdentifier: targetPID) else {
			throw AccessibilityFailure.invalidProcess(targetPID)
		}
		let settleMs = request.settleMs ?? 300
		if settleMs > 0 {
			_ = await UISettleDetector.waitForSettle(
				pid: targetPID,
				timeoutMs: request.timeoutMs ?? 2000,
				settleMs: settleMs,
				pollMs: request.pollMs ?? 50
			)
		}

		let screenshot = try await ScreenshotCapture.capture(width: screenshotWidth(request), height: screenshotHeight(request))
		let tree = AccessibilityTree.extract(pid: targetPID)
		let frontmostPID = NSWorkspace.shared.frontmostApplication?.processIdentifier
		return .success(
			id: request.id,
			pid: targetPID,
			data: screenshot.data.base64EncodedString(),
			width: screenshot.width,
			height: screenshot.height,
			axAvailable: tree.axAvailable,
			elements: tree.elements.map(AXElementJSON.init),
			app: runningApp.localizedName ?? runningApp.bundleIdentifier ?? String(targetPID),
			bundleId: runningApp.bundleIdentifier,
			frontmost: frontmostPID == targetPID
		)
	}

	private func appStatePID(_ request: HelperRequest) throws -> Int32 {
		if let pid = request.pid, pid > 0 { return pid }
		guard let frontmostPID = NSWorkspace.shared.frontmostApplication?.processIdentifier, frontmostPID > 0 else {
			throw HelperFailure.invalid("no frontmost application available")
		}
		return frontmostPID
	}

	private func listApps() -> [AppInfoJSON] {
		NSWorkspace.shared.runningApplications
			.filter { $0.activationPolicy == .regular }
			.map { app in
				AppInfoJSON(
					name: app.localizedName ?? app.bundleIdentifier ?? String(app.processIdentifier),
					bundleId: app.bundleIdentifier,
					pid: app.processIdentifier,
					isActive: app.isActive
				)
			}
			.sorted { left, right in left.name.localizedCaseInsensitiveCompare(right.name) == .orderedAscending }
	}

	private func write(_ response: HelperResponse) {
		do {
			let data = try encoder.encode(response)
			if let line = String(data: data, encoding: .utf8) {
				FileHandle.standardOutput.write(Data((line + "\n").utf8))
			}
		} catch {
			fputs("failed to encode response: \(error)\n", stderr)
		}
	}
}

NSApplication.shared.setActivationPolicy(.accessory)
await HelperServer().run()

// MIT License
// Lightweight UI-settle detector: polls a cheap accessibility fingerprint until it stabilises.

import ApplicationServices
import CoreGraphics
import Foundation

enum UISettleDetector {
	static func waitForSettle(pid: pid_t, timeoutMs: Int = 2000, settleMs: Int = 300, pollMs: Int = 50) async -> Bool {
		guard pid > 0 else { return true }
		let app = AXUIElementCreateApplication(pid)
		let timeout = UInt64(timeoutMs) * 1_000_000
		let settle = UInt64(settleMs) * 1_000_000
		let poll = UInt64(pollMs) * 1_000_000
		let start = clock_gettime_nsec_np(CLOCK_MONOTONIC)
		var lastFingerprint: WindowFingerprint?
		var stableStart: UInt64?

		while clock_gettime_nsec_np(CLOCK_MONOTONIC) - start < timeout {
			let fingerprint = sampleFingerprint(app: app)
			let now = clock_gettime_nsec_np(CLOCK_MONOTONIC)
			if let current = fingerprint, current == lastFingerprint {
				if let begin = stableStart {
					if now - begin >= settle { return true }
				} else {
					stableStart = now
				}
			} else {
				stableStart = nil
				lastFingerprint = fingerprint
			}
			try? await Task.sleep(nanoseconds: poll)
		}
		return false
	}

	private static func sampleFingerprint(app: AXUIElement) -> WindowFingerprint? {
		var value: AnyObject?
		guard AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &value) == .success else { return nil }
		guard let window = value else { return nil }
		let position = axPoint(window)
		let size = axSize(window)
		let children = axChildrenCount(window)
		return WindowFingerprint(
			x: Double(position?.x ?? 0),
			y: Double(position?.y ?? 0),
			width: Double(size?.width ?? 0),
			height: Double(size?.height ?? 0),
			children: children
		)
	}

	private static func axPoint(_ element: AnyObject) -> CGPoint? {
		var value: AnyObject?
		guard AXUIElementCopyAttributeValue(element as! AXUIElement, kAXPositionAttribute as CFString, &value) == .success else { return nil }
		var point = CGPoint.zero
		guard let axValue = value else { return nil }
		guard AXValueGetValue(axValue as! AXValue, .cgPoint, &point) else { return nil }
		return point
	}

	private static func axSize(_ element: AnyObject) -> CGSize? {
		var value: AnyObject?
		guard AXUIElementCopyAttributeValue(element as! AXUIElement, kAXSizeAttribute as CFString, &value) == .success else { return nil }
		var size = CGSize.zero
		guard let axValue = value else { return nil }
		guard AXValueGetValue(axValue as! AXValue, .cgSize, &size) else { return nil }
		return size
	}

	private static func axChildrenCount(_ element: AnyObject) -> Int {
		var value: AnyObject?
		guard AXUIElementCopyAttributeValue(element as! AXUIElement, kAXChildrenAttribute as CFString, &value) == .success else { return 0 }
		guard let array = value as? [AnyObject] else { return 0 }
		return array.count
	}
}

private struct WindowFingerprint: Equatable {
	let x: Double
	let y: Double
	let width: Double
	let height: Double
	let children: Int
}

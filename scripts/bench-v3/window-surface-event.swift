import CoreGraphics
import CoreMedia
import Darwin
import Foundation
import ScreenCaptureKit

// Fixture oracle only. Subscribe before closing the caller's exact owned window.
// Display frames are wakeups, never evidence that the window has disappeared.
// No sample pixels are accessed, retained, encoded, or written.
func fail(_ message: String, code: Int32 = 2) -> Never {
	fputs(message + "\n", stderr)
	exit(code)
}

let arguments = CommandLine.arguments
guard arguments.count == 3,
	arguments[1].utf8.allSatisfy({ $0 >= 48 && $0 <= 57 }),
	arguments[2].utf8.allSatisfy({ $0 >= 48 && $0 <= 57 }),
	let pid = Int32(arguments[1]), pid > 0,
	let windowID = UInt32(arguments[2]), windowID > 0
else { fail("Usage: window-surface-event PID WINDOW_ID (positive integers)", code: 1) }

// A one-shot failure deadline, not a predicate polling timer. Includes startup.
DispatchQueue.global().asyncAfter(deadline: .now() + .seconds(10)) {
	fail("Timed out waiting for an operational display stream and window surface removal", code: 4)
}

func requireConsole() {
	guard let session = CGSessionCopyCurrentDictionary() as? [String: Any],
		session["kCGSSessionOnConsoleKey"] as? Bool == true,
		session["kCGSessionLoginDoneKey"] as? Bool == true,
		(session["kCGSSessionUserIDKey"] as? NSNumber)?.uint32Value == getuid(),
		session["CGSSessionScreenIsLocked"] as? Bool != true
	else { fail("An unlocked, logged-in console session owned by this user is required") }
}

requireConsole()
guard CGPreflightScreenCaptureAccess() else {
	fail("Existing Screen Recording permission is required; no permission was requested")
}

func surfaceRemoved(pid: Int32, windowID: UInt32) -> Bool {
	requireConsole()
	// .optionIncludingWindow selects only this ID, including off-screen windows.
	guard
		let rows = CGWindowListCopyWindowInfo(.optionIncludingWindow, windowID)
			as? [[String: Any]]
	else { fail("CGWindowList query failed") }
	guard let row = rows.first else { return true }
	guard rows.count == 1,
		(row[kCGWindowNumber as String] as? NSNumber)?.uint32Value == windowID,
		(row[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid
	else { fail("Target window ID does not belong to the supplied PID") }
	guard let onScreen = row[kCGWindowIsOnscreen as String] as? Bool else {
		fail("Target window has no on-screen state")
	}
	return !onScreen
}

// Validate ownership before requesting any stream. Absence is valid: ownership
// cannot be recovered for a window already gone, but no other window is accepted.
_ = surfaceRemoved(pid: pid, windowID: windowID)

@available(macOS 12.3, *)
final class SurfaceObserver: NSObject, SCStreamOutput, SCStreamDelegate {
	let pid: Int32
	let windowID: UInt32
	var streams: [SCStream] = []
	var started = 0
	var subscribed = false

	init(pid: Int32, windowID: UInt32) {
		self.pid = pid
		self.windowID = windowID
		super.init()
	}

	func check() {
		guard subscribed else { return }
		if surfaceRemoved(pid: pid, windowID: windowID) {
			print("READY")
			fflush(stdout)
			exit(0)
		}
	}

	func stream(
		_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
		of type: SCStreamOutputType
	) {
		guard type == .screen,
			let attachments = CMSampleBufferGetSampleAttachmentsArray(
				sampleBuffer,
				createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
			let raw = attachments.first?[.status] as? Int,
			let status = SCFrameStatus(rawValue: raw)
		else { fail("Display stream returned no frame status") }
		switch status {
		case .complete, .started:
			// Only actual new compositor frames trigger the exact CG predicate.
			check()
		case .idle:
			break
		case .blank, .suspended, .stopped:
			fail("Display stream is blank, suspended, or stopped")
		@unknown default:
			fail("Unknown display frame status")
		}
	}

	func stream(_ stream: SCStream, didStopWithError error: Error) {
		// Do not log OS error descriptions, which may contain unrelated metadata.
		fail("Display stream failed")
	}

	func arm(_ content: SCShareableContent) {
		requireConsole()
		guard !content.displays.isEmpty else { fail("No capturable displays") }
		for display in content.displays {
			let configuration = SCStreamConfiguration()
			configuration.width = 2
			configuration.height = 2
			configuration.queueDepth = 3
			configuration.showsCursor = false
			configuration.minimumFrameInterval = .zero
			// Use display streams, not a window stream that dies at AX destruction.
			// All displays cover window moves; buffers are discarded without access.
			let filter = SCContentFilter(display: display, excludingWindows: [])
			let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
			do {
				try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: .main)
			} catch { fail("Could not register display output") }
			streams.append(stream)
		}
		for stream in streams {
			stream.startCapture { error in
				DispatchQueue.main.async {
					guard error == nil else { fail("Could not start display stream") }
					self.started += 1
					if self.started == self.streams.count {
						self.subscribed = true
						print("SUBSCRIBED")
						fflush(stdout)
						// Close the subscribe/check race even if no further frame arrives.
						self.check()
					}
				}
			}
		}
	}
}

guard #available(macOS 12.3, *) else { fail("ScreenCaptureKit requires macOS 12.3 or newer") }
let observer = SurfaceObserver(pid: pid, windowID: windowID)
SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: false) { content, error in
	DispatchQueue.main.async {
		guard error == nil, let content = content else {
			fail("Could not enumerate capturable displays")
		}
		observer.arm(content)
	}
}
// Blocks on events; no run-loop ticks, sleeps, or polling.
dispatchMain()

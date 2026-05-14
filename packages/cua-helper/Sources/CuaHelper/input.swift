// MIT License
// SkyLight event-posting behavior is based on reverse-engineering notes from trycua's MIT-licensed cua-driver,
// reimplemented here for macos-cua's JSON-over-stdio helper.

import AppKit
import CoreGraphics
import Darwin
import Foundation
import ObjectiveC

enum SkyLightBridge {
	private typealias PostToPidFn = @convention(c) (pid_t, CGEvent) -> Void
	private typealias SetAuthMessageFn = @convention(c) (CGEvent, AnyObject) -> Void
	private typealias SetIntFieldFn = @convention(c) (CGEvent, UInt32, Int64) -> Void
	private typealias ConnectionIDFn = @convention(c) () -> UInt32
	private typealias SetWindowLocationFn = @convention(c) (CGEvent, CGPoint) -> Void
	private typealias PostEventRecordToFn = @convention(c) (UnsafeRawPointer, UnsafePointer<UInt8>) -> Int32
	private typealias GetFrontProcessFn = @convention(c) (UnsafeMutableRawPointer) -> Int32
	private typealias GetWindowOwnerFn = @convention(c) (UInt32, UInt32, UnsafeMutablePointer<UInt32>) -> Int32
	private typealias GetConnectionPSNFn = @convention(c) (UInt32, UnsafeMutableRawPointer) -> Int32
	private typealias FactoryMsgSendFn = @convention(c) (
		AnyObject, Selector, UnsafeMutableRawPointer, Int32, UInt32
	) -> AnyObject?

	private static let skyLightHandle: UnsafeMutableRawPointer? = dlopen(
		"/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight",
		RTLD_LAZY
	)

	private static let postToPidFn: PostToPidFn? = loadSkyLightSymbol("SLEventPostToPid")
	private static let setAuthMessageFn: SetAuthMessageFn? = loadSkyLightSymbol("SLEventSetAuthenticationMessage")
	private static let setIntFieldFn: SetIntFieldFn? = loadSkyLightSymbol("SLEventSetIntegerValueField")
	private static let connectionIDFn: ConnectionIDFn? = loadSkyLightSymbol("CGSMainConnectionID")
	private static let setWindowLocationFn: SetWindowLocationFn? = loadSkyLightSymbol("CGEventSetWindowLocation")
	private static let postEventRecordToFn: PostEventRecordToFn? = loadSkyLightSymbol("SLPSPostEventRecordTo")
	private static let getFrontProcessFn: GetFrontProcessFn? = loadSkyLightSymbol("_SLPSGetFrontProcess")
	private static let getWindowOwnerFn: GetWindowOwnerFn? = loadSkyLightSymbol("SLSGetWindowOwner")
	private static let getConnectionPSNFn: GetConnectionPSNFn? = loadSkyLightSymbol("SLSGetConnectionPSN")
	private static let msgSendFactoryFn: FactoryMsgSendFn? = loadDefaultSymbol("objc_msgSend")
	private static let messageClass: AnyClass? = NSClassFromString("SLSEventAuthenticationMessage")
	private static let factorySelector = NSSelectorFromString("messageWithEventRecord:pid:version:")

	static var canPost: Bool { postToPidFn != nil }

	static func postToPid(_ pid: pid_t, event: CGEvent, auth: Bool) -> Bool {
		guard let post = postToPidFn else { return false }
		if auth,
		   let setAuth = setAuthMessageFn,
		   let send = msgSendFactoryFn,
		   let klass = messageClass,
		   let record = eventRecord(from: event),
		   let message = send(klass as AnyObject, factorySelector, record, pid, 0)
		{
			setAuth(event, message)
		}
		post(pid, event)
		return true
	}

	static func setIntegerField(_ event: CGEvent, field: UInt32, value: Int64) {
		setIntFieldFn?(event, field, value)
	}

	static func setWindowLocation(_ event: CGEvent, point: CGPoint) {
		setWindowLocationFn?(event, point)
	}

	static func activateWithoutRaise(pid: pid_t, windowID: CGWindowID) -> Bool {
		guard getFrontProcessFn != nil,
		      postEventRecordToFn != nil,
		      getWindowOwnerFn != nil,
		      getConnectionPSNFn != nil,
		      connectionIDFn != nil
		else { return false }

		var previousPSN = [UInt32](repeating: 0, count: 2)
		let previousOk = previousPSN.withUnsafeMutableBytes { raw -> Bool in
			guard let base = raw.baseAddress else { return false }
			return getFrontProcessFn?(base) == 0
		}
		guard previousOk else { return false }

		var targetPSN = [UInt32](repeating: 0, count: 2)
		let targetOk = targetPSN.withUnsafeMutableBytes { raw -> Bool in
			guard let base = raw.baseAddress else { return false }
			return processSerialNumber(forWindowID: windowID, into: base)
		}
		guard targetOk else { return false }

		var bytes = [UInt8](repeating: 0, count: 0xF8)
		bytes[0x04] = 0xF8
		bytes[0x08] = 0x0D
		let windowValue = UInt32(windowID)
		bytes[0x3C] = UInt8(windowValue & 0xFF)
		bytes[0x3D] = UInt8((windowValue >> 8) & 0xFF)
		bytes[0x3E] = UInt8((windowValue >> 16) & 0xFF)
		bytes[0x3F] = UInt8((windowValue >> 24) & 0xFF)

		bytes[0x8A] = 0x02
		let defocused = postRecord(psn: previousPSN, bytes: bytes)
		bytes[0x8A] = 0x01
		let focused = postRecord(psn: targetPSN, bytes: bytes)
		_ = pid
		return defocused && focused
	}

	private static func processSerialNumber(forWindowID windowID: CGWindowID, into buffer: UnsafeMutableRawPointer) -> Bool {
		guard let owner = getWindowOwnerFn, let psn = getConnectionPSNFn, let connection = connectionIDFn else { return false }
		var ownerConnection: UInt32 = 0
		guard owner(connection(), UInt32(windowID), &ownerConnection) == 0 else { return false }
		return psn(ownerConnection, buffer) == 0
	}

	private static func postRecord(psn: [UInt32], bytes: [UInt8]) -> Bool {
		guard let post = postEventRecordToFn else { return false }
		return psn.withUnsafeBytes { psnRaw in
			bytes.withUnsafeBufferPointer { byteBuffer in
				guard let psnBase = psnRaw.baseAddress, let byteBase = byteBuffer.baseAddress else { return false }
				return post(psnBase, byteBase) == 0
			}
		}
	}

	private static func eventRecord(from event: CGEvent) -> UnsafeMutableRawPointer? {
		let base = Unmanaged.passUnretained(event).toOpaque()
		for offset in [24, 32, 16] {
			let slot = base.advanced(by: offset).assumingMemoryBound(to: UnsafeMutableRawPointer?.self)
			if let pointer = slot.pointee { return pointer }
		}
		return nil
	}

	private static func loadSkyLightSymbol<T>(_ name: String) -> T? {
		guard let handle = skyLightHandle, let pointer = dlsym(handle, name) else { return nil }
		return unsafeBitCast(pointer, to: T.self)
	}

	private static func loadDefaultSymbol<T>(_ name: String) -> T? {
		guard let pointer = dlsym(UnsafeMutableRawPointer(bitPattern: -2), name) else { return nil }
		return unsafeBitCast(pointer, to: T.self)
	}
}

enum WindowLookup {
	static func frontmostWindow(for pid: Int32) -> TargetWindow? {
		guard let windows = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] else {
			return nil
		}
		return windows.compactMap { info -> (layer: Int, window: TargetWindow)? in
			guard (info[kCGWindowOwnerPID as String] as? Int32) == pid,
			      (info[kCGWindowIsOnscreen as String] as? Bool) == true,
			      let number = info[kCGWindowNumber as String] as? UInt32,
			      let layer = info[kCGWindowLayer as String] as? Int,
			      let boundsDictionary = info[kCGWindowBounds as String] as? [String: CGFloat]
			else { return nil }
			let rect = CGRect(
				x: boundsDictionary["X"] ?? 0,
				y: boundsDictionary["Y"] ?? 0,
				width: boundsDictionary["Width"] ?? 0,
				height: boundsDictionary["Height"] ?? 0
			)
			return (layer, TargetWindow(id: CGWindowID(number), bounds: rect))
		}
		.sorted { left, right in left.layer == right.layer ? left.window.id < right.window.id : left.layer < right.layer }
		.first?.window
	}
}

enum InputActions {
	static func click(pid: Int32, point: CGPoint, button: MouseButton, count: Int, modifiers: [String]) throws {
		let clampedCount = max(1, min(2, count))
		if button == .left, modifiers.isEmpty {
			try leftClickWithPrimer(pid: pid, point: point, count: clampedCount)
			return
		}
		try clickPostBoth(pid: pid, point: point, button: button, count: clampedCount, modifiers: modifiers)
	}

	static func move(pid: Int32, point: CGPoint) throws {
		let window = WindowLookup.frontmostWindow(for: pid)
		let event = try mouseEvent(type: .mouseMoved, screenPoint: point, modifiers: [], clickCount: 0, windowID: window?.id ?? 0)
		stampMouse(event, pid: pid, window: window, screenPoint: point, button: .left, clickState: 0)
		postBoth(pid: pid, event: event)
	}

	static func drag(pid: Int32, from start: CGPoint, to end: CGPoint, duration: Int, steps: Int, modifiers: [String]) throws {
		let window = WindowLookup.frontmostWindow(for: pid)
		let clampedSteps = max(1, min(maximumDragSteps, steps))
		let perStep = useconds_t(max(0, duration) * 1_000 / clampedSteps)
		let flags = nsModifierMask(modifiers)
		let down = try mouseEvent(type: .leftMouseDown, screenPoint: start, modifiers: flags, clickCount: 1, windowID: window?.id ?? 0)
		stampMouse(down, pid: pid, window: window, screenPoint: start, button: .left, clickState: 1)
		postBoth(pid: pid, event: down)

		for step in 1...clampedSteps {
			let progress = Double(step) / Double(clampedSteps)
			let point = CGPoint(x: start.x + (end.x - start.x) * progress, y: start.y + (end.y - start.y) * progress)
			let drag = try mouseEvent(type: .leftMouseDragged, screenPoint: point, modifiers: flags, clickCount: 1, windowID: window?.id ?? 0)
			stampMouse(drag, pid: pid, window: window, screenPoint: point, button: .left, clickState: 1)
			usleep(perStep)
			postBoth(pid: pid, event: drag)
		}

		let up = try mouseEvent(type: .leftMouseUp, screenPoint: end, modifiers: flags, clickCount: 1, windowID: window?.id ?? 0)
		stampMouse(up, pid: pid, window: window, screenPoint: end, button: .left, clickState: 1)
		usleep(perStep)
		postBoth(pid: pid, event: up)
	}

	static func key(pid: Int32, key: String?, keyCode: UInt16?, modifiers: [String]) throws {
		let code = try keyCode ?? virtualKeyCode(for: key ?? "")
		let flags = cgModifierMask(modifiers)
		try postKey(pid: pid, keyCode: code, keyDown: true, flags: flags)
		try postKey(pid: pid, keyCode: code, keyDown: false, flags: flags)
	}

	static func typeText(pid: Int32, text: String) throws {
		for character in text {
			let utf16 = Array(String(character).utf16)
			for keyDown in [true, false] {
				guard let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: keyDown) else {
					throw HelperFailure.eventCreation("unicode \(character)")
				}
				event.flags = []
				utf16.withUnsafeBufferPointer { buffer in
					if let base = buffer.baseAddress {
						event.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: base)
					}
				}
				if !SkyLightBridge.postToPid(pid, event: event, auth: false) {
					event.postToPid(pid)
				}
			}
			usleep(30_000)
		}
	}

	private static func leftClickWithPrimer(pid: Int32, point: CGPoint, count: Int) throws {
		guard SkyLightBridge.canPost else { throw HelperFailure.skylightUnavailable("SLEventPostToPid") }
		let window = WindowLookup.frontmostWindow(for: pid)
		if let target = window {
			_ = SkyLightBridge.activateWithoutRaise(pid: pid, windowID: target.id)
			usleep(50_000)
		}

		func make(_ type: NSEvent.EventType, screenPoint: CGPoint, clickCount: Int, clickState: Int64) throws -> CGEvent {
			let event = try mouseEvent(type: type, screenPoint: screenPoint, modifiers: [], clickCount: clickCount, windowID: window?.id ?? 0)
			stampMouse(event, pid: pid, window: window, screenPoint: screenPoint, button: .left, clickState: clickState)
			return event
		}

		let offscreen = CGPoint(x: -1, y: -1)
		postSkyLightOnly(pid: pid, event: try make(.mouseMoved, screenPoint: point, clickCount: 0, clickState: 1))
		usleep(15_000)
		postSkyLightOnly(pid: pid, event: try make(.leftMouseDown, screenPoint: offscreen, clickCount: 1, clickState: 1))
		usleep(1_000)
		postSkyLightOnly(pid: pid, event: try make(.leftMouseUp, screenPoint: offscreen, clickCount: 1, clickState: 1))
		usleep(100_000)
		for pairIndex in 1...count {
			let state = Int64(pairIndex)
			postSkyLightOnly(pid: pid, event: try make(.leftMouseDown, screenPoint: point, clickCount: pairIndex, clickState: state))
			usleep(1_000)
			postSkyLightOnly(pid: pid, event: try make(.leftMouseUp, screenPoint: point, clickCount: pairIndex, clickState: state))
			if pairIndex < count { usleep(80_000) }
		}
	}

	private static func clickPostBoth(pid: Int32, point: CGPoint, button: MouseButton, count: Int, modifiers: [String]) throws {
		let window = WindowLookup.frontmostWindow(for: pid)
		let flags = nsModifierMask(modifiers)
		let types = eventTypes(button)
		for pairIndex in 1...count {
			let down = try mouseEvent(type: types.down, screenPoint: point, modifiers: flags, clickCount: pairIndex, windowID: window?.id ?? 0)
			let up = try mouseEvent(type: types.up, screenPoint: point, modifiers: flags, clickCount: pairIndex, windowID: window?.id ?? 0)
			stampMouse(down, pid: pid, window: window, screenPoint: point, button: button, clickState: Int64(pairIndex))
			stampMouse(up, pid: pid, window: window, screenPoint: point, button: button, clickState: Int64(pairIndex))
			postBoth(pid: pid, event: down)
			usleep(30_000)
			postBoth(pid: pid, event: up)
			if pairIndex < count { usleep(80_000) }
		}
	}

	private static func mouseEvent(
		type: NSEvent.EventType,
		screenPoint: CGPoint,
		modifiers: NSEvent.ModifierFlags,
		clickCount: Int,
		windowID: CGWindowID
	) throws -> CGEvent {
		guard let event = NSEvent.mouseEvent(
			with: type,
			location: cocoaPoint(screenPoint),
			modifierFlags: modifiers,
			timestamp: ProcessInfo.processInfo.systemUptime,
			windowNumber: Int(windowID),
			context: nil,
			eventNumber: 0,
			clickCount: clickCount,
			pressure: 1.0
		) else { throw HelperFailure.eventCreation("NSEvent \(type.rawValue)") }
		guard let cgEvent = event.cgEvent else { throw HelperFailure.eventCreation("CGEvent bridge \(type.rawValue)") }
		return cgEvent
	}

	private static func stampMouse(
		_ event: CGEvent,
		pid: Int32,
		window: TargetWindow?,
		screenPoint: CGPoint,
		button: MouseButton,
		clickState: Int64
	) {
		event.location = screenPoint
		event.timestamp = clock_gettime_nsec_np(CLOCK_UPTIME_RAW)
		event.setIntegerValueField(.mouseEventButtonNumber, value: Int64(buttonNumber(button)))
		event.setIntegerValueField(.mouseEventSubtype, value: 3)
		event.setIntegerValueField(.mouseEventClickState, value: clickState)
		if let target = window {
			event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(target.id))
			event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(target.id))
			SkyLightBridge.setWindowLocation(event, point: CGPoint(x: screenPoint.x - target.bounds.minX, y: screenPoint.y - target.bounds.minY))
		} else {
			SkyLightBridge.setWindowLocation(event, point: screenPoint)
		}
		SkyLightBridge.setIntegerField(event, field: 40, value: Int64(pid))
	}

	private static func postSkyLightOnly(pid: Int32, event: CGEvent) {
		event.timestamp = clock_gettime_nsec_np(CLOCK_UPTIME_RAW)
		_ = SkyLightBridge.postToPid(pid, event: event, auth: false)
	}

	private static func postBoth(pid: Int32, event: CGEvent) {
		event.timestamp = clock_gettime_nsec_np(CLOCK_UPTIME_RAW)
		_ = SkyLightBridge.postToPid(pid, event: event, auth: false)
		event.postToPid(pid)
	}

	private static func postKey(pid: Int32, keyCode: UInt16, keyDown: Bool, flags: CGEventFlags) throws {
		guard let event = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(keyCode), keyDown: keyDown) else {
			throw HelperFailure.eventCreation("key \(keyCode)")
		}
		event.flags = flags
		if !SkyLightBridge.postToPid(pid, event: event, auth: true) {
			event.postToPid(pid)
		}
	}

	private static func cocoaPoint(_ screenPoint: CGPoint) -> CGPoint {
		let height = NSScreen.main?.frame.height ?? NSScreen.screens.first?.frame.height ?? 0
		return CGPoint(x: screenPoint.x, y: height - screenPoint.y)
	}

	private static func eventTypes(_ button: MouseButton) -> (down: NSEvent.EventType, up: NSEvent.EventType) {
		switch button {
		case .left: return (.leftMouseDown, .leftMouseUp)
		case .right: return (.rightMouseDown, .rightMouseUp)
		case .middle: return (.otherMouseDown, .otherMouseUp)
		}
	}

	private static func buttonNumber(_ button: MouseButton) -> Int {
		switch button {
		case .left: return 0
		case .right: return 1
		case .middle: return 2
		}
	}

	private static func nsModifierMask(_ modifiers: [String]) -> NSEvent.ModifierFlags {
		var flags: NSEvent.ModifierFlags = []
		for modifier in modifiers {
			switch modifier.lowercased() {
			case "command", "cmd", "meta": flags.insert(.command)
			case "shift": flags.insert(.shift)
			case "option", "alt": flags.insert(.option)
			case "control", "ctrl": flags.insert(.control)
			case "fn", "function": flags.insert(.function)
			default: break
			}
		}
		return flags
	}

	private static func cgModifierMask(_ modifiers: [String]) -> CGEventFlags {
		var flags: CGEventFlags = []
		for modifier in modifiers {
			switch modifier.lowercased() {
			case "command", "cmd", "meta": flags.insert(.maskCommand)
			case "shift": flags.insert(.maskShift)
			case "option", "alt": flags.insert(.maskAlternate)
			case "control", "ctrl": flags.insert(.maskControl)
			case "fn", "function": flags.insert(.maskSecondaryFn)
			default: break
			}
		}
		return flags
	}

	private static func virtualKeyCode(for key: String) throws -> UInt16 {
		let normalized = key.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().replacingOccurrences(of: " ", with: "")
		guard let code = keyCodes[normalized] else { throw HelperFailure.invalid("unsupported key: \(key)") }
		return code
	}

	private static let keyCodes: [String: UInt16] = [
		"a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11,
		"q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21,
		"6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31,
		"u": 32, "[": 33, "i": 34, "p": 35, "return": 36, "enter": 36, "l": 37, "j": 38, "'": 39, "k": 40,
		";": 41, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "tab": 48, "space": 49, "": 49,
		"grave": 50, "`": 50, "delete": 51, "backspace": 51, "escape": 53, "esc": 53, "command": 55, "cmd": 55,
		"shift": 56, "capslock": 57, "option": 58, "alt": 58, "control": 59, "ctrl": 59, "rightshift": 60,
		"rightoption": 61, "rightalt": 61, "rightcontrol": 62, "rightctrl": 62, "fn": 63, "f17": 64, "f5": 96,
		"f6": 97, "f7": 98, "f3": 99, "f8": 100, "f9": 101, "f11": 103, "f13": 105, "f16": 106,
		"f14": 107, "f10": 109, "f12": 111, "f15": 113, "help": 114, "home": 115, "pageup": 116,
		"forwarddelete": 117, "f4": 118, "end": 119, "f2": 120, "pagedown": 121, "f1": 122, "left": 123,
		"arrowleft": 123, "right": 124, "arrowright": 124, "down": 125, "arrowdown": 125, "up": 126, "arrowup": 126,
	]
}

func pid(_ request: HelperRequest) throws -> Int32 {
	guard let pid = request.pid, pid > 0 else { throw HelperFailure.missing("pid") }
	return pid
}

func point(_ request: HelperRequest) throws -> CGPoint {
	guard let x = request.x else { throw HelperFailure.missing("x") }
	guard let y = request.y else { throw HelperFailure.missing("y") }
	return CGPoint(x: x, y: y)
}

func fromPoint(_ request: HelperRequest) throws -> CGPoint {
	guard let x = request.fromX else { throw HelperFailure.missing("fromX") }
	guard let y = request.fromY else { throw HelperFailure.missing("fromY") }
	return CGPoint(x: x, y: y)
}

func toPoint(_ request: HelperRequest) throws -> CGPoint {
	guard let x = request.toX else { throw HelperFailure.missing("toX") }
	guard let y = request.toY else { throw HelperFailure.missing("toY") }
	return CGPoint(x: x, y: y)
}

func button(_ request: HelperRequest, fallback: MouseButton) -> MouseButton {
	request.button.flatMap(MouseButton.init(rawValue:)) ?? fallback
}

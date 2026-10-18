import AppKit
import Foundation

private enum ToolMode: String {
	case draw
	case shape
	case orbit
	case text
}

private struct Stroke {
	var points: [CGPoint]
}

private struct Shape {
	let start: CGPoint
	let end: CGPoint

	var rect: CGRect {
		CGRect(
			x: min(start.x, end.x),
			y: min(start.y, end.y),
			width: abs(end.x - start.x),
			height: abs(end.y - start.y)
		)
	}
}

private enum FixtureLog {
	static func write(_ event: String, fields: [String: Any] = [:]) {
		var object = fields
		object["event"] = event
		object["timestamp"] = ProcessInfo.processInfo.systemUptime
		guard
			let data = try? JSONSerialization.data(
				withJSONObject: object, options: [.fragmentsAllowed]),
			let line = String(data: data, encoding: .utf8)
		else {
			return
		}
		FileHandle.standardOutput.write(Data((line + "\n").utf8))
	}

	static func point(_ point: CGPoint) -> [String: Double] {
		["x": Double(point.x), "y": Double(point.y)]
	}

	static func rect(_ rect: CGRect) -> [String: Double] {
		[
			"x": Double(rect.origin.x),
			"y": Double(rect.origin.y),
			"width": Double(rect.width),
			"height": Double(rect.height),
		]
	}

	static func modifiers(_ flags: NSEvent.ModifierFlags) -> [String] {
		var names: [String] = []
		if flags.contains(.shift) { names.append("shift") }
		if flags.contains(.control) { names.append("control") }
		if flags.contains(.option) { names.append("option") }
		if flags.contains(.command) { names.append("command") }
		if flags.contains(.function) { names.append("function") }
		if flags.contains(.capsLock) { names.append("capsLock") }
		return names
	}
}

private final class FixtureWindow: NSWindow {
	override var canBecomeKey: Bool { true }
}

private final class FixtureCanvas: NSView {
	var mode: ToolMode = .draw
	var strokes: [Stroke] = []
	var activeStroke: Stroke?
	var shapes: [Shape] = []
	var activeShape: Shape?
	var yaw = 0.65
	var pitch = -0.35
	var previousOrbitPoint: CGPoint?
	var orbiting = false

	override var isFlipped: Bool { true }

	override func accessibilityValue() -> Any? {
		let state: [String: Any] = [
			"strokes": strokes.map { $0.points.map { FixtureLog.point($0) } },
			"shapes": shapes.map { FixtureLog.rect($0.rect) },
			"yaw": yaw, "pitch": pitch, "mode": mode.rawValue,
		]
		guard let data = try? JSONSerialization.data(withJSONObject: state) else { return nil }
		return String(data: data, encoding: .utf8)
	}

	override func draw(_ dirtyRect: NSRect) {
		NSColor(calibratedWhite: 0.97, alpha: 1).setFill()
		bounds.fill()

		let inset = bounds.insetBy(dx: 18, dy: 18)
		NSColor(calibratedWhite: 0.82, alpha: 1).setStroke()
		let border = NSBezierPath(roundedRect: inset, xRadius: 8, yRadius: 8)
		border.lineWidth = 1
		border.stroke()

		for stroke in strokes {
			drawStroke(stroke)
		}
		if let activeStroke {
			drawStroke(activeStroke)
		}

		for shape in shapes {
			drawShape(shape)
		}
		if let activeShape {
			drawShape(activeShape)
		}

		drawCube()
	}

	override func mouseDown(with event: NSEvent) {
		beginGesture(event, button: event.buttonNumber)
	}

	override func rightMouseDown(with event: NSEvent) {
		beginGesture(event, button: event.buttonNumber)
	}

	override func otherMouseDown(with event: NSEvent) {
		beginGesture(event, button: event.buttonNumber)
	}

	override func mouseDragged(with event: NSEvent) {
		continueGesture(event, button: event.buttonNumber)
	}

	override func rightMouseDragged(with event: NSEvent) {
		continueGesture(event, button: event.buttonNumber)
	}

	override func otherMouseDragged(with event: NSEvent) {
		continueGesture(event, button: event.buttonNumber)
	}

	override func mouseUp(with event: NSEvent) {
		endGesture(event, button: event.buttonNumber)
	}

	override func rightMouseUp(with event: NSEvent) {
		endGesture(event, button: event.buttonNumber)
	}

	override func otherMouseUp(with event: NSEvent) {
		endGesture(event, button: event.buttonNumber)
	}

	private func beginGesture(_ event: NSEvent, button: Int) {
		let point = convert(event.locationInWindow, from: nil)
		let isOrbit =
			button == 1 || mode == .orbit || (button == 0 && event.modifierFlags.contains(.option))
		orbiting = isOrbit
		previousOrbitPoint = isOrbit ? point : nil
		if !isOrbit {
			switch mode {
			case .draw:
				activeStroke = Stroke(points: [point])
			case .shape:
				activeShape = Shape(start: point, end: point)
			case .orbit, .text:
				break
			}
		}
		needsDisplay = true
		logMouse("mouseDown", event: event, button: button)
	}

	private func continueGesture(_ event: NSEvent, button: Int) {
		let point = convert(event.locationInWindow, from: nil)
		if orbiting, let previousOrbitPoint {
			yaw += (point.x - previousOrbitPoint.x) * 0.012
			pitch = min(max(pitch + (point.y - previousOrbitPoint.y) * 0.012, -1.45), 1.45)
			self.previousOrbitPoint = point
		} else if var activeStroke {
			activeStroke.points.append(point)
			self.activeStroke = activeStroke
		} else if let activeShape {
			self.activeShape = Shape(start: activeShape.start, end: point)
		}
		needsDisplay = true
		logMouse("mouseDragged", event: event, button: button)
	}

	private func endGesture(_ event: NSEvent, button: Int) {
		let point = convert(event.locationInWindow, from: nil)
		if orbiting {
			previousOrbitPoint = nil
			orbiting = false
		} else if var activeStroke {
			activeStroke.points.append(point)
			strokes.append(activeStroke)
			self.activeStroke = nil
		} else if let activeShape {
			shapes.append(Shape(start: activeShape.start, end: point))
			self.activeShape = nil
		}
		needsDisplay = true
		logMouse("mouseUp", event: event, button: button)
	}

	private func logMouse(_ name: String, event: NSEvent, button: Int) {
		let point = convert(event.locationInWindow, from: nil)
		let screenPoint =
			window?.convertPoint(toScreen: event.locationInWindow) ?? event.locationInWindow
		FixtureLog.write(
			name,
			fields: [
				"locationInWindow": FixtureLog.point(event.locationInWindow),
				"locationInCanvas": FixtureLog.point(point),
				"locationOnScreen": FixtureLog.point(screenPoint),
				"button": button,
				"modifiers": FixtureLog.modifiers(event.modifierFlags),
				"mode": mode.rawValue,
				"strokeCount": strokes.count,
				"activeStrokePointCount": activeStroke?.points.count ?? 0,
				"shapeCount": shapes.count,
				"activeShape": activeShape.map { FixtureLog.rect($0.rect) } ?? NSNull(),
				"orbit": ["yaw": yaw, "pitch": pitch, "dragging": orbiting],
			]
		)
	}

	private func drawStroke(_ stroke: Stroke) {
		guard let first = stroke.points.first else { return }
		let path = NSBezierPath()
		path.lineWidth = 3
		path.lineCapStyle = .round
		path.lineJoinStyle = .round
		path.move(to: first)
		for point in stroke.points.dropFirst() {
			path.line(to: point)
		}
		NSColor.systemBlue.setStroke()
		path.stroke()
	}

	private func drawShape(_ shape: Shape) {
		let path = NSBezierPath(rect: shape.rect)
		path.lineWidth = 2
		NSColor.systemOrange.setStroke()
		path.stroke()
	}

	private func drawCube() {
		let size = 58.0
		let vertices: [(Double, Double, Double)] = [
			(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
			(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1),
		]
		let projected = vertices.map { vertex -> CGPoint in
			let (x, y, z) = vertex
			let yawX = x * cos(yaw) - z * sin(yaw)
			let yawZ = x * sin(yaw) + z * cos(yaw)
			let pitchY = y * cos(pitch) - yawZ * sin(pitch)
			return CGPoint(x: bounds.maxX - 98 + yawX * size, y: 96 + pitchY * size)
		}
		let edges = [
			(0, 1), (1, 2), (2, 3), (3, 0),
			(4, 5), (5, 6), (6, 7), (7, 4),
			(0, 4), (1, 5), (2, 6), (3, 7),
		]
		NSColor.systemPurple.setStroke()
		let path = NSBezierPath()
		path.lineWidth = 2.5
		for (start, end) in edges {
			path.move(to: projected[start])
			path.line(to: projected[end])
		}
		path.stroke()
	}
}

private final class FixtureController: NSObject, NSTextFieldDelegate {
	let window: FixtureWindow
	let canvas: FixtureCanvas
	private let textField: NSTextField
	private let modeButtons: [NSButton]
	private var mode: ToolMode = .draw

	init(
		window: FixtureWindow, canvas: FixtureCanvas, textField: NSTextField,
		modeButtons: [NSButton]
	) {
		self.window = window
		self.canvas = canvas
		self.textField = textField
		self.modeButtons = modeButtons
		super.init()
	}

	@objc func chooseMode(_ sender: NSButton) {
		guard let rawValue = sender.identifier?.rawValue,
			let selectedMode = ToolMode(rawValue: rawValue)
		else {
			return
		}
		mode = selectedMode
		canvas.mode = selectedMode
		for button in modeButtons {
			button.state = button === sender ? .on : .off
		}
		if selectedMode == .text {
			window.makeFirstResponder(textField)
		}
		canvas.needsDisplay = true
		FixtureLog.write(
			"modeChanged", fields: ["mode": selectedMode.rawValue, "button": sender.title])
	}

	func controlTextDidChange(_ notification: Notification) {
		guard let field = notification.object as? NSTextField else { return }
		FixtureLog.write(
			"textEditing", fields: ["value": field.stringValue, "selectionMode": mode.rawValue])
	}
}

private final class FixtureAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
	private var window: FixtureWindow?
	private var controller: FixtureController?
	private var lastModifierFlags: NSEvent.ModifierFlags = []
	private var keyboardMonitor: Any?
	private var workspaceMonitor: NSObjectProtocol?

	func applicationDidFinishLaunching(_ notification: Notification) {
		workspaceMonitor = NSWorkspace.shared.notificationCenter.addObserver(
			forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
		) { notification in
			guard
				let application = notification.userInfo?[NSWorkspace.applicationUserInfoKey]
					as? NSRunningApplication
			else { return }
			FixtureLog.write(
				"foregroundChanged",
				fields: [
					"pid": application.processIdentifier,
					"bundleId": application.bundleIdentifier ?? "",
				])
		}
		let window = FixtureWindow(
			contentRect: NSRect(x: 180, y: 180, width: 760, height: 520),
			styleMask: [.titled, .closable, .miniaturizable, .resizable],
			backing: .buffered,
			defer: false
		)
		window.title =
			ProcessInfo.processInfo.environment["APPLE_CUA_FIXTURE_TITLE"]
			?? "apple-cua Background Input QA"
		window.isReleasedWhenClosed = false
		window.delegate = self

		let root = NSView()
		root.translatesAutoresizingMaskIntoConstraints = false
		window.contentView = root

		let canvas = FixtureCanvas()
		canvas.translatesAutoresizingMaskIntoConstraints = false
		canvas.setAccessibilityLabel("Custom drawing canvas")
		canvas.setAccessibilityElement(true)
		canvas.setAccessibilityRole(.group)
		root.addSubview(canvas)

		let modeButtons = ToolMode.allCases.map { mode in
			let button = NSButton(title: mode.rawValue.capitalized, target: nil, action: nil)
			button.identifier = NSUserInterfaceItemIdentifier(mode.rawValue)
			button.bezelStyle = .rounded
			button.setAccessibilityLabel(mode.rawValue.capitalized)
			return button
		}
		let textField = NSTextField(string: "")
		textField.placeholderString = "Type here"
		textField.setAccessibilityLabel("Text input")
		textField.translatesAutoresizingMaskIntoConstraints = false

		let stack = NSStackView(views: modeButtons + [textField])
		stack.orientation = .horizontal
		stack.alignment = .centerY
		stack.distribution = .fill
		stack.spacing = 8
		stack.translatesAutoresizingMaskIntoConstraints = false
		root.addSubview(stack)

		let controller = FixtureController(
			window: window, canvas: canvas, textField: textField, modeButtons: modeButtons)
		self.controller = controller
		for button in modeButtons {
			button.target = controller
			button.action = #selector(FixtureController.chooseMode(_:))
		}
		textField.delegate = controller
		modeButtons.first?.state = .on

		NSLayoutConstraint.activate([
			stack.topAnchor.constraint(equalTo: root.topAnchor, constant: 14),
			stack.centerXAnchor.constraint(equalTo: root.centerXAnchor),
			textField.widthAnchor.constraint(equalToConstant: 220),
			canvas.topAnchor.constraint(equalTo: stack.bottomAnchor, constant: 12),
			canvas.leadingAnchor.constraint(equalTo: root.leadingAnchor),
			canvas.trailingAnchor.constraint(equalTo: root.trailingAnchor),
			canvas.bottomAnchor.constraint(equalTo: root.bottomAnchor),
		])

		self.window = window
		window.orderFront(nil)
		keyboardMonitor = NSEvent.addLocalMonitorForEvents(matching: [
			.keyDown, .keyUp, .flagsChanged,
		]) { [weak self] event in
			self?.logKeyboardEvent(event)
			return event
		}
		FixtureLog.write(
			"windowGeometry",
			fields: [
				"reason": "launch",
				"frameOnScreen": FixtureLog.rect(window.frame),
				"contentSize": FixtureLog.rect(window.contentView?.bounds ?? .zero),
				"activationPolicy": "accessory",
			]
		)
	}

	func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
		true
	}

	func applicationDidResignActive(_ notification: Notification) {
		FixtureLog.write("applicationActivation", fields: ["active": false])
	}

	func applicationDidBecomeActive(_ notification: Notification) {
		FixtureLog.write("applicationActivation", fields: ["active": true])
	}

	func windowDidMove(_ notification: Notification) {
		logGeometry(reason: "move")
	}

	func windowDidResize(_ notification: Notification) {
		logGeometry(reason: "resize")
	}

	private func logKeyboardEvent(_ event: NSEvent) {
		switch event.type {
		case .keyDown:
			FixtureLog.write(
				"keyDown",
				fields: [
					"keyCode": event.keyCode,
					"characters": event.characters ?? "",
					"modifiers": FixtureLog.modifiers(event.modifierFlags),
				]
			)
		case .keyUp:
			FixtureLog.write(
				"keyUp",
				fields: [
					"keyCode": event.keyCode,
					"characters": event.characters ?? "",
					"modifiers": FixtureLog.modifiers(event.modifierFlags),
				]
			)
		case .flagsChanged:
			let flags = event.modifierFlags
			FixtureLog.write(
				"modifierChanged",
				fields: [
					"keyCode": event.keyCode,
					"modifiers": FixtureLog.modifiers(flags),
					"previousModifiers": FixtureLog.modifiers(lastModifierFlags),
				]
			)
			lastModifierFlags = flags
		default:
			break
		}
	}

	private func logGeometry(reason: String) {
		guard let window else { return }
		FixtureLog.write(
			"windowGeometry",
			fields: [
				"reason": reason,
				"frameOnScreen": FixtureLog.rect(window.frame),
				"contentSize": FixtureLog.rect(window.contentView?.bounds ?? .zero),
			]
		)
	}
}

extension ToolMode: CaseIterable {}

private let fixtureDelegate = FixtureAppDelegate()
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
app.delegate = fixtureDelegate
app.run()

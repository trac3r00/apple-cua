// MIT License
// AX tree extraction for macos-cua's JSON-over-stdio helper.

import ApplicationServices
import CoreGraphics
import Darwin
import Foundation

struct AXElement {
	let id: Int
	let role: String
	let label: String?
	let value: String?
	let frame: CGRect
	let actions: [String]
	let children: [Int]
}

struct AXFrameJSON: Codable {
	let x: Double
	let y: Double
	let width: Double
	let height: Double
}

struct AXElementJSON: Codable {
	let id: Int
	let role: String
	let label: String?
	let value: String?
	let frame: AXFrameJSON
	let actions: [String]
	let children: [Int]

	init(_ element: AXElement) {
		id = element.id
		role = element.role
		label = element.label
		value = element.value
		frame = AXFrameJSON(
			x: Double(element.frame.origin.x),
			y: Double(element.frame.origin.y),
			width: Double(element.frame.size.width),
			height: Double(element.frame.size.height)
		)
		actions = element.actions
		children = element.children
	}
}

enum AccessibilityFailure: Error, CustomStringConvertible {
	case permissionDenied
	case invalidProcess(pid_t)
	case extractionFailed(String)

	var description: String {
		switch self {
		case .permissionDenied: return "accessibility permission denied"
		case .invalidProcess(let pid): return "invalid process: \(pid)"
		case .extractionFailed(let message): return "accessibility extraction failed: \(message)"
		}
	}
}

enum AccessibilityTree {
	static func extract(pid: pid_t, maxDepth: Int = 10, maxElements: Int = 500) -> (elements: [AXElement], axAvailable: Bool) {
		guard AXIsProcessTrusted(), isRunning(pid: pid), maxDepth >= 0, maxElements > 0 else {
			return ([], false)
		}

		let root = AXUIElementCreateApplication(pid)
		guard !children(of: root).isEmpty else { return ([], false) }

		var elements: [AXElement] = []
		append(element: root, depth: 0, maxDepth: maxDepth, maxElements: maxElements, into: &elements)
		return elements.isEmpty ? ([], false) : (elements, true)
	}

	static func performAction(pid: pid_t, elementIndex: Int, action: String) throws {
		let element = try refetch(pid: pid, elementIndex: elementIndex)
		let result = AXUIElementPerformAction(element, action as CFString)
		guard result == .success else { throw AccessibilityFailure.extractionFailed("perform action failed: \(result)") }
	}

	static func setValue(pid: pid_t, elementIndex: Int, value: String) throws {
		let element = try refetch(pid: pid, elementIndex: elementIndex)
		let result = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFString)
		guard result == .success else { throw AccessibilityFailure.extractionFailed("set value failed: \(result)") }
	}

	private static func refetch(pid: pid_t, elementIndex: Int, maxDepth: Int = 10, maxElements: Int = 500) throws -> AXUIElement {
		guard AXIsProcessTrusted() else { throw AccessibilityFailure.permissionDenied }
		guard isRunning(pid: pid), elementIndex >= 0, elementIndex < maxElements else {
			throw AccessibilityFailure.invalidProcess(pid)
		}

		let root = AXUIElementCreateApplication(pid)
		var cursor = 0
		if let matched = find(element: root, targetIndex: elementIndex, depth: 0, maxDepth: maxDepth, maxElements: maxElements, cursor: &cursor) {
			return matched
		}
		throw AccessibilityFailure.extractionFailed("element not found")
	}

	@discardableResult
	private static func append(
		element: AXUIElement,
		depth: Int,
		maxDepth: Int,
		maxElements: Int,
		into elements: inout [AXElement]
	) -> Int? {
		guard depth <= maxDepth, elements.count < maxElements else { return nil }

		let id = elements.count
		let frame = frame(of: element)
		elements.append(
			AXElement(
				id: id,
				role: stringAttribute(kAXRoleAttribute, of: element) ?? "",
				label: stringAttribute(kAXTitleAttribute, of: element) ?? stringAttribute(kAXDescriptionAttribute, of: element),
				value: stringValueAttribute(of: element),
				frame: frame,
				actions: actionNames(of: element),
				children: []
			)
		)

		var childIDs: [Int] = []
		if depth < maxDepth {
			for child in children(of: element) {
				guard elements.count < maxElements else { break }
				if let childID = append(element: child, depth: depth + 1, maxDepth: maxDepth, maxElements: maxElements, into: &elements) {
					childIDs.append(childID)
				}
			}
		}

		let current = elements[id]
		elements[id] = AXElement(
			id: current.id,
			role: current.role,
			label: current.label,
			value: current.value,
			frame: current.frame,
			actions: current.actions,
			children: childIDs
		)
		return id
	}

	private static func find(
		element: AXUIElement,
		targetIndex: Int,
		depth: Int,
		maxDepth: Int,
		maxElements: Int,
		cursor: inout Int
	) -> AXUIElement? {
		guard depth <= maxDepth, cursor < maxElements else { return nil }
		if cursor == targetIndex { return element }
		cursor += 1

		guard depth < maxDepth else { return nil }
		for child in children(of: element) {
			if let matched = find(
				element: child,
				targetIndex: targetIndex,
				depth: depth + 1,
				maxDepth: maxDepth,
				maxElements: maxElements,
				cursor: &cursor
			) {
				return matched
			}
			guard cursor < maxElements else { break }
		}
		return nil
	}

	private static func stringAttribute(_ attribute: String, of element: AXUIElement) -> String? {
		guard let value = copyAttribute(attribute, of: element) else { return nil }
		return value as? String
	}

	private static func stringValueAttribute(of element: AXUIElement) -> String? {
		guard let value = copyAttribute(kAXValueAttribute, of: element) else { return nil }
		if let string = value as? String { return string }
		if let number = value as? NSNumber { return number.stringValue }
		return String(describing: value)
	}

	private static func frame(of element: AXUIElement) -> CGRect {
		let position = pointAttribute(kAXPositionAttribute, of: element) ?? .zero
		let size = sizeAttribute(kAXSizeAttribute, of: element) ?? .zero
		return CGRect(origin: position, size: size)
	}

	private static func pointAttribute(_ attribute: String, of element: AXUIElement) -> CGPoint? {
		guard let value = copyAttribute(attribute, of: element), CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
		let axValue = unsafeBitCast(value, to: AXValue.self)
		guard AXValueGetType(axValue) == .cgPoint else { return nil }
		var point = CGPoint.zero
		guard AXValueGetValue(axValue, .cgPoint, &point) else { return nil }
		return point
	}

	private static func sizeAttribute(_ attribute: String, of element: AXUIElement) -> CGSize? {
		guard let value = copyAttribute(attribute, of: element), CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
		let axValue = unsafeBitCast(value, to: AXValue.self)
		guard AXValueGetType(axValue) == .cgSize else { return nil }
		var size = CGSize.zero
		guard AXValueGetValue(axValue, .cgSize, &size) else { return nil }
		return size
	}

	private static func children(of element: AXUIElement) -> [AXUIElement] {
		guard let value = copyAttribute(kAXChildrenAttribute, of: element) else { return [] }
		guard let array = value as? [Any] else { return [] }
		return array.compactMap { child -> AXUIElement? in
			let value = child as CFTypeRef
			guard CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
			return unsafeBitCast(value, to: AXUIElement.self)
		}
	}

	private static func actionNames(of element: AXUIElement) -> [String] {
		var actions: CFArray?
		let result = AXUIElementCopyActionNames(element, &actions)
		guard result == .success, let actions else { return [] }
		return (actions as? [String]) ?? []
	}

	private static func copyAttribute(_ attribute: String, of element: AXUIElement) -> CFTypeRef? {
		var value: CFTypeRef?
		let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
		guard result == .success else { return nil }
		return value
	}

	private static func isRunning(pid: pid_t) -> Bool {
		pid > 0 && kill(pid, 0) == 0
	}
}

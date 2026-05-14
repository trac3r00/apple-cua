// MIT License
// SkyLight event-posting behavior is based on reverse-engineering notes from trycua's MIT-licensed cua-driver,
// reimplemented here for macos-cua's JSON-over-stdio helper.

import CoreGraphics
import Foundation

let helperVersion = "0.1.0"
let defaultDragSteps = 20
let maximumDragSteps = 200

struct HelperRequest: Decodable {
	let id: String
	let cmd: String
	let pid: Int32?
	let x: Double?
	let y: Double?
	let fromX: Double?
	let fromY: Double?
	let toX: Double?
	let toY: Double?
	let button: String?
	let count: Int?
	let modifiers: [String]?
	let key: String?
	let keyCode: UInt16?
	let text: String?
	let duration: Int?
	let steps: Int?
	let timeoutMs: Int?
	let settleMs: Int?
	let pollMs: Int?
	let width: Int?
	let height: Int?
	let elementIndex: Int?
	let targetValue: String?
	let action: String?
}

struct HelperResponse: Encodable {
	let id: String
	let ok: Bool
	let error: String?
	let x: Double?
	let y: Double?
	let version: String?
	let settled: Bool?
	let data: String?
	let width: Int?
	let height: Int?
	let axAvailable: Bool?
	let elements: [AXElementJSON]?

	static func success(
		id: String,
		x: Double? = nil,
		y: Double? = nil,
		version: String? = nil,
		settled: Bool? = nil,
		data: String? = nil,
		width: Int? = nil,
		height: Int? = nil,
		axAvailable: Bool? = nil,
		elements: [AXElementJSON]? = nil
	) -> HelperResponse {
		HelperResponse(
			id: id,
			ok: true,
			error: nil,
			x: x,
			y: y,
			version: version,
			settled: settled,
			data: data,
			width: width,
			height: height,
			axAvailable: axAvailable,
			elements: elements
		)
	}

	static func failure(id: String, _ error: String) -> HelperResponse {
		HelperResponse(
			id: id,
			ok: false,
			error: error,
			x: nil,
			y: nil,
			version: nil,
			settled: nil,
			data: nil,
			width: nil,
			height: nil,
			axAvailable: nil,
			elements: nil
		)
	}
}

enum HelperFailure: Error, CustomStringConvertible {
	case missing(String)
	case invalid(String)
	case eventCreation(String)
	case noWindow(Int32)
	case skylightUnavailable(String)

	var description: String {
		switch self {
		case .missing(let field): return "missing required field: \(field)"
		case .invalid(let message): return message
		case .eventCreation(let phase): return "failed to create event: \(phase)"
		case .noWindow(let pid): return "no on-screen target window found for pid \(pid)"
		case .skylightUnavailable(let symbol): return "required SkyLight symbol unavailable: \(symbol)"
		}
	}
}

enum MouseButton: String {
	case left
	case right
	case middle
}

struct TargetWindow {
	let id: CGWindowID
	let bounds: CGRect
}

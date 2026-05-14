// MIT License
// Screen capture path for macos-cua's JSON-over-stdio helper.

import CoreGraphics
import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

enum ScreenshotFailure: Error, CustomStringConvertible {
	case permissionDenied
	case noDisplays
	case captureFailed(String)
	case encodeFailed

	var description: String {
		switch self {
		case .permissionDenied: return "screen recording permission denied"
		case .noDisplays: return "no displays available for screenshot"
		case .captureFailed(let message): return "screenshot capture failed: \(message)"
		case .encodeFailed: return "failed to encode screenshot PNG"
		}
	}
}

enum ScreenshotCapture {
	private static let context = CIContext(options: [.cacheIntermediates: false])

	static func capture(width: Int, height: Int) async throws -> (data: Data, width: Int, height: Int) {
		guard CGPreflightScreenCaptureAccess() else { throw ScreenshotFailure.permissionDenied }

		let content: SCShareableContent
		do {
			content = try await SCShareableContent.current
		} catch {
			if !CGPreflightScreenCaptureAccess() { throw ScreenshotFailure.permissionDenied }
			throw ScreenshotFailure.captureFailed(error.localizedDescription)
		}

		guard !content.displays.isEmpty else { throw ScreenshotFailure.noDisplays }
		let mainDisplayID = CGMainDisplayID()
		let display = content.displays.first { $0.displayID == mainDisplayID } ?? content.displays[0]

		let configuration = SCStreamConfiguration()
		configuration.width = display.width
		configuration.height = display.height
		configuration.pixelFormat = kCVPixelFormatType_32BGRA
		configuration.showsCursor = true

		let filter = SCContentFilter(display: display, excludingWindows: [])
		let image: CGImage
		do {
			image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
		} catch {
			if !CGPreflightScreenCaptureAccess() { throw ScreenshotFailure.permissionDenied }
			throw ScreenshotFailure.captureFailed(error.localizedDescription)
		}

		let resized = try resize(image, width: width, height: height)
		let png = try encodePNG(resized)
		return (data: png, width: width, height: height)
	}

	private static func resize(_ image: CGImage, width: Int, height: Int) throws -> CGImage {
		guard width > 0, height > 0 else {
			throw ScreenshotFailure.captureFailed("requested screenshot dimensions must be positive")
		}

		let input = CIImage(cgImage: image)
		let scaleX = CGFloat(width) / CGFloat(image.width)
		let scaleY = CGFloat(height) / CGFloat(image.height)
		let output = input.transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))
		let extent = CGRect(x: 0, y: 0, width: width, height: height)

		guard let resized = context.createCGImage(output, from: extent) else {
			throw ScreenshotFailure.captureFailed("failed to render resized screenshot")
		}
		return resized
	}

	private static func encodePNG(_ image: CGImage) throws -> Data {
		let data = NSMutableData()
		guard let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else {
			throw ScreenshotFailure.encodeFailed
		}
		CGImageDestinationAddImage(destination, image, nil)
		guard CGImageDestinationFinalize(destination) else { throw ScreenshotFailure.encodeFailed }
		return data as Data
	}
}

func screenshotWidth(_ request: HelperRequest) throws -> Int {
	guard let width = request.width else { throw HelperFailure.missing("width") }
	guard width > 0 else { throw HelperFailure.invalid("width must be positive") }
	return width
}

func screenshotHeight(_ request: HelperRequest) throws -> Int {
	guard let height = request.height else { throw HelperFailure.missing("height") }
	guard height > 0 else { throw HelperFailure.invalid("height must be positive") }
	return height
}

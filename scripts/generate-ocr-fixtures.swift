
import AppKit
import CoreText
import Foundation

// Renders deterministic OCR fixtures: known strings at known anchors, black on white.
// Usage: swift generate-ocr-fixtures.swift <output-directory>

struct Line {
    let text: String
    let x: CGFloat
    let baselineY: CGFloat   // measured from the TOP of the image, downward
    let pointSize: CGFloat
}

func render(width: Int, height: Int, scale: Int, lines: [Line], path: String) throws {
    let pixelWidth = width * scale
    let pixelHeight = height * scale
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    guard let context = CGContext(
        data: nil, width: pixelWidth, height: pixelHeight,
        bitsPerComponent: 8, bytesPerRow: 0, space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { throw NSError(domain: "render", code: 1) }
    context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: pixelWidth, height: pixelHeight))
    context.scaleBy(x: CGFloat(scale), y: CGFloat(scale))
    // Flip to a top-left origin so the fixture anchors are stated the way OCR boxes are read,
    // then flip the TEXT matrix back so glyphs stay upright instead of mirrored.
    context.translateBy(x: 0, y: CGFloat(height))
    context.scaleBy(x: 1, y: -1)
    context.textMatrix = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 0, ty: 0)

    for line in lines {
        let font = CTFontCreateWithName("Helvetica-Bold" as CFString, line.pointSize, nil)
        let attributed = NSAttributedString(string: line.text, attributes: [
            .font: font,
            .foregroundColor: NSColor.black,
        ])
        context.textPosition = CGPoint(x: line.x, y: line.baselineY)
        CTLineDraw(CTLineCreateWithAttributedString(attributed), context)
    }

    guard let image = context.makeImage() else { throw NSError(domain: "render", code: 2) }
    let rep = NSBitmapImageRep(cgImage: image)
    guard let data = rep.representation(using: .png, properties: [:]) else { throw NSError(domain: "render", code: 3) }
    try data.write(to: URL(fileURLWithPath: path))
    print("wrote \(path) \(pixelWidth)x\(pixelHeight)")
}

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."

try render(width: 800, height: 400, scale: 1, lines: [
    Line(text: "ZQX-4471", x: 60, baselineY: 110, pointSize: 48),
    Line(text: "Settings", x: 60, baselineY: 210, pointSize: 48),
    Line(text: "Wi-Fi", x: 60, baselineY: 310, pointSize: 48),
], path: out + "/ocr-sample-1x.png")

try render(width: 800, height: 400, scale: 2, lines: [
    Line(text: "ZQX-4471", x: 60, baselineY: 110, pointSize: 48),
    Line(text: "Settings", x: 60, baselineY: 210, pointSize: 48),
    Line(text: "Wi-Fi", x: 60, baselineY: 310, pointSize: 48),
], path: out + "/ocr-sample-2x.png")

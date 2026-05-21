import type { KoffiFunc } from "koffi";
import { type CFTypeRef, cfRelease, withCFString } from "./corefoundation.js";
import { koffi } from "./koffi.js";

type CGImageRef = CFTypeRef;
type CGContextRef = CFTypeRef;
type CGColorSpaceRef = CFTypeRef;
type CGImageDestinationRef = CFTypeRef;
type CFMutableDataRef = CFTypeRef;

type CGPoint = { x: number; y: number };
type CGSize = { width: number; height: number };
type CGRect = { origin: CGPoint; size: CGSize };
type CFRange = { location: number; length: number };

const CG_POINT = koffi.struct("CGPointForScreenshot", { x: "double", y: "double" });
const CG_SIZE = koffi.struct("CGSize", { width: "double", height: "double" });
const CG_RECT = koffi.struct("CGRect", { origin: CG_POINT, size: CG_SIZE });
const CF_RANGE = koffi.struct("CFRange", { location: "long", length: "long" });

const CG_IMAGE_REF = koffi.pointer("CGImageRef", koffi.opaque());
const CG_CONTEXT_REF = koffi.pointer("CGContextRef", koffi.opaque());
const CG_COLOR_SPACE_REF = koffi.pointer("CGColorSpaceRef", koffi.opaque());
const CG_IMAGE_DESTINATION_REF = koffi.pointer("CGImageDestinationRef", koffi.opaque());
const CF_MUTABLE_DATA_REF = koffi.pointer("CFMutableDataRef", koffi.opaque());

const coreGraphics = koffi.load("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics");
const imageIO = koffi.load("/System/Library/Frameworks/ImageIO.framework/ImageIO");
const coreFoundation = koffi.load("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation");

const K_BITMAP_PREMULTIPLIED_LAST = 1;
const PNG_UNIFORM_TYPE = "public.png";

const CGMainDisplayID = coreGraphics.func("CGMainDisplayID", "uint32_t", []) as KoffiFunc<() => number>;

const CGDisplayBounds = coreGraphics.func("CGDisplayBounds", CG_RECT, ["uint32_t"]) as KoffiFunc<
	(displayId: number) => CGRect
>;

const CGDisplayCreateImage = coreGraphics.func("CGDisplayCreateImage", CG_IMAGE_REF, ["uint32_t"]) as KoffiFunc<
	(displayId: number) => CGImageRef | null
>;

const CGImageGetWidth = coreGraphics.func("CGImageGetWidth", "size_t", [CG_IMAGE_REF]) as KoffiFunc<
	(image: CGImageRef) => number
>;

const CGImageGetHeight = coreGraphics.func("CGImageGetHeight", "size_t", [CG_IMAGE_REF]) as KoffiFunc<
	(image: CGImageRef) => number
>;

const CGColorSpaceCreateDeviceRGB = coreGraphics.func(
	"CGColorSpaceCreateDeviceRGB",
	CG_COLOR_SPACE_REF,
	[],
) as KoffiFunc<() => CGColorSpaceRef | null>;

const CGBitmapContextCreate = coreGraphics.func("CGBitmapContextCreate", CG_CONTEXT_REF, [
	"void *",
	"size_t",
	"size_t",
	"size_t",
	"size_t",
	CG_COLOR_SPACE_REF,
	"uint32_t",
]) as KoffiFunc<
	(
		data: null,
		width: number,
		height: number,
		bitsPerComponent: number,
		bytesPerRow: number,
		colorSpace: CGColorSpaceRef,
		bitmapInfo: number,
	) => CGContextRef | null
>;

const CGContextDrawImage = coreGraphics.func("CGContextDrawImage", "void", [
	CG_CONTEXT_REF,
	CG_RECT,
	CG_IMAGE_REF,
]) as KoffiFunc<(context: CGContextRef, rect: CGRect, image: CGImageRef) => void>;

const CGBitmapContextCreateImage = coreGraphics.func("CGBitmapContextCreateImage", CG_IMAGE_REF, [
	CG_CONTEXT_REF,
]) as KoffiFunc<(context: CGContextRef) => CGImageRef | null>;

const CGImageDestinationCreateWithData = imageIO.func("CGImageDestinationCreateWithData", CG_IMAGE_DESTINATION_REF, [
	"void *",
	"void *",
	"size_t",
	"void *",
]) as KoffiFunc<
	(data: CFMutableDataRef, type: CFTypeRef, count: number, options: null) => CGImageDestinationRef | null
>;

const CGImageDestinationAddImage = imageIO.func("CGImageDestinationAddImage", "void", [
	CG_IMAGE_DESTINATION_REF,
	CG_IMAGE_REF,
	"void *",
]) as KoffiFunc<(destination: CGImageDestinationRef, image: CGImageRef, properties: null) => void>;

const CGImageDestinationFinalize = imageIO.func("CGImageDestinationFinalize", "bool", [
	CG_IMAGE_DESTINATION_REF,
]) as KoffiFunc<(destination: CGImageDestinationRef) => boolean>;

const CFDataCreateMutable = coreFoundation.func("CFDataCreateMutable", CF_MUTABLE_DATA_REF, [
	"void *",
	"long",
]) as KoffiFunc<(allocator: null, capacity: number) => CFMutableDataRef | null>;

const CFDataGetLength = coreFoundation.func("CFDataGetLength", "long", ["void *"]) as KoffiFunc<
	(data: CFMutableDataRef) => number
>;

const CFDataGetBytes = coreFoundation.func("CFDataGetBytes", "void", ["void *", CF_RANGE, "char *"]) as KoffiFunc<
	(data: CFMutableDataRef, range: CFRange, buffer: Buffer) => void
>;

export type CapturedScreenshot = {
	readonly data: Buffer;
	readonly width: number;
	readonly height: number;
};

export function captureMainDisplayPng(targetWidth: number, targetHeight: number): CapturedScreenshot {
	if (targetWidth <= 0 || targetHeight <= 0) {
		throw new Error(`captureMainDisplayPng requires positive dimensions, got ${targetWidth}x${targetHeight}`);
	}

	const displayId = CGMainDisplayID();
	const sourceImage = CGDisplayCreateImage(displayId);
	if (sourceImage === null) {
		throw new Error("CGDisplayCreateImage returned null (Screen Recording permission may be missing)");
	}

	try {
		const colorSpace = CGColorSpaceCreateDeviceRGB();
		if (colorSpace === null) {
			throw new Error("CGColorSpaceCreateDeviceRGB returned null");
		}

		try {
			const context = CGBitmapContextCreate(
				null,
				targetWidth,
				targetHeight,
				8,
				0,
				colorSpace,
				K_BITMAP_PREMULTIPLIED_LAST,
			);
			if (context === null) {
				throw new Error(`CGBitmapContextCreate returned null for ${targetWidth}x${targetHeight}`);
			}

			try {
				CGContextDrawImage(
					context,
					{ origin: { x: 0, y: 0 }, size: { width: targetWidth, height: targetHeight } },
					sourceImage,
				);

				const resizedImage = CGBitmapContextCreateImage(context);
				if (resizedImage === null) {
					throw new Error("CGBitmapContextCreateImage returned null");
				}

				try {
					const pngBytes = encodeImageAsPng(resizedImage);
					return {
						data: pngBytes,
						width: targetWidth,
						height: targetHeight,
					};
				} finally {
					cfRelease(resizedImage);
				}
			} finally {
				cfRelease(context);
			}
		} finally {
			cfRelease(colorSpace);
		}
	} finally {
		cfRelease(sourceImage);
	}
}

export function getMainDisplayNativePixelSize(): { width: number; height: number } {
	const sourceImage = CGDisplayCreateImage(CGMainDisplayID());
	if (sourceImage === null) {
		throw new Error("CGDisplayCreateImage returned null (Screen Recording permission may be missing)");
	}
	try {
		return { width: CGImageGetWidth(sourceImage), height: CGImageGetHeight(sourceImage) };
	} finally {
		cfRelease(sourceImage);
	}
}

export function getMainDisplayLogicalSize(): { width: number; height: number } {
	const bounds = CGDisplayBounds(CGMainDisplayID());
	return {
		width: Math.round(bounds.size.width),
		height: Math.round(bounds.size.height),
	};
}

function encodeImageAsPng(image: CGImageRef): Buffer {
	return withCFString(PNG_UNIFORM_TYPE, (pngType) => {
		const cfData = CFDataCreateMutable(null, 0);
		if (cfData === null) {
			throw new Error("CFDataCreateMutable returned null");
		}

		try {
			const destination = CGImageDestinationCreateWithData(cfData, pngType, 1, null);
			if (destination === null) {
				throw new Error("CGImageDestinationCreateWithData returned null");
			}

			try {
				CGImageDestinationAddImage(destination, image, null);
				if (!CGImageDestinationFinalize(destination)) {
					throw new Error("CGImageDestinationFinalize returned false");
				}

				const length = CFDataGetLength(cfData);
				if (length <= 0) {
					throw new Error(`PNG encode produced no bytes (length=${length})`);
				}

				const buffer = Buffer.alloc(length);
				CFDataGetBytes(cfData, { location: 0, length }, buffer);
				return buffer;
			} finally {
				cfRelease(destination);
			}
		} finally {
			cfRelease(cfData);
		}
	});
}

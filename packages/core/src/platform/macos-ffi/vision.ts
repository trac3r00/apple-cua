import { readFileSync } from "node:fs";
import type { KoffiFunc } from "koffi";
import { koffi } from "./koffi.js";

/** A recognised text box in image pixels with a top-left origin — the space a capture is read in. */
export interface OcrBox {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface OcrTextObservation {
	readonly text: string;
	readonly confidence: number;
	readonly box: OcrBox;
}

export interface RecognizeTextOptions {
	/** "accurate" (default) trades time for fidelity; "fast" skips the language-correction pass. */
	readonly level?: "accurate" | "fast";
	readonly usesLanguageCorrection?: boolean;
	/** Recognition languages, most preferred first (BCP-47 tags such as "en-US"). */
	readonly languages?: readonly string[];
	/** Drop observations below this confidence. Vision reports 1.0 for clean print. */
	readonly minimumConfidence?: number;
}

const VISION_FRAMEWORK = "/System/Library/Frameworks/Vision.framework/Vision";
const IMAGE_IO_FRAMEWORK = "/System/Library/Frameworks/ImageIO.framework/ImageIO";
const CORE_FOUNDATION_FRAMEWORK = "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation";
const LIBOBJC = "/usr/lib/libobjc.A.dylib";

const ACCURATE_LEVEL = 0;
const FAST_LEVEL = 1;

type Pointer = object;

interface VisionBindings {
	readonly cfDataCreate: KoffiFunc<(allocator: null, bytes: Buffer, length: number) => Pointer | null>;
	readonly cfRelease: KoffiFunc<(reference: Pointer) => void>;
	readonly imageSourceCreateWithData: KoffiFunc<(data: Pointer, options: null) => Pointer | null>;
	readonly imageSourceCreateImageAtIndex: KoffiFunc<(source: Pointer, index: number, options: null) => Pointer | null>;
	readonly imageGetWidth: KoffiFunc<(image: Pointer) => number>;
	readonly imageGetHeight: KoffiFunc<(image: Pointer) => number>;
	readonly classForName: (name: string) => Pointer;
	readonly selector: (name: string) => Pointer;
	readonly imageRequestHandlerClass: Pointer;
	readonly recognizeTextRequestClass: Pointer;
	readonly mutableArrayClass: Pointer;
	readonly stringClass: Pointer;
	readonly alloc: KoffiFunc<(receiver: Pointer, selector: Pointer) => Pointer>;
	readonly initTextRequest: KoffiFunc<(receiver: Pointer, selector: Pointer) => Pointer>;
	readonly initHandlerWithImage: KoffiFunc<
		(receiver: Pointer, selector: Pointer, image: Pointer, options: null) => Pointer | null
	>;
	readonly setRecognitionLevel: KoffiFunc<(receiver: Pointer, selector: Pointer, level: number) => void>;
	readonly setUsesLanguageCorrection: KoffiFunc<(receiver: Pointer, selector: Pointer, enabled: boolean) => void>;
	readonly setRecognitionLanguages: KoffiFunc<
		(receiver: Pointer, selector: Pointer, languages: Pointer | null) => void
	>;
	readonly arrayWithCapacity: KoffiFunc<(receiver: Pointer, selector: Pointer, capacity: number) => Pointer | null>;
	readonly addObject: KoffiFunc<(receiver: Pointer, selector: Pointer, value: Pointer) => void>;
	readonly stringWithUtf8: KoffiFunc<(receiver: Pointer, selector: Pointer, bytes: Buffer) => Pointer | null>;
	readonly performRequests: KoffiFunc<
		(receiver: Pointer, selector: Pointer, requests: Pointer, error: [Pointer | null]) => boolean
	>;
	readonly release: KoffiFunc<(receiver: Pointer, selector: Pointer) => void>;
	readonly results: KoffiFunc<(receiver: Pointer, selector: Pointer) => Pointer | null>;
	readonly count: KoffiFunc<(receiver: Pointer, selector: Pointer) => number>;
	readonly objectAtIndex: KoffiFunc<(receiver: Pointer, selector: Pointer, index: number) => Pointer | null>;
	readonly boundingBox: KoffiFunc<(receiver: Pointer, selector: Pointer) => OcrBox>;
	readonly topCandidates: KoffiFunc<(receiver: Pointer, selector: Pointer, count: number) => Pointer | null>;
	readonly string: KoffiFunc<(receiver: Pointer, selector: Pointer) => Pointer | null>;
	readonly utf8String: KoffiFunc<(receiver: Pointer, selector: Pointer) => string>;
	readonly confidence: KoffiFunc<(receiver: Pointer, selector: Pointer) => number>;
}

let cachedBindings: VisionBindings | null | undefined;

/** True when the Vision framework and the Objective-C runtime can be bound on this machine. */
export function isVisionOcrAvailable(): boolean {
	return bindings() !== null;
}

/**
 * Recognised text for an encoded image (PNG or JPEG), one observation per recognised line.
 * Coordinates are image pixels with a top-left origin, so a caller maps them onto whatever
 * the image was captured from — a window rect, a display, or an iPhone Mirroring window.
 */
export function recognizeTextInImage(
	imageBytes: Buffer,
	options: RecognizeTextOptions = {},
): readonly OcrTextObservation[] {
	const bound = requireBindings();
	if (imageBytes.byteLength === 0) {
		throw new Error("cannot recognise text in an empty image buffer");
	}

	const data = bound.cfDataCreate(null, imageBytes, imageBytes.byteLength);
	if (data === null) {
		throw new Error("cannot copy the image bytes into a CFData");
	}
	try {
		const source = bound.imageSourceCreateWithData(data, null);
		if (source === null) {
			throw new Error("cannot decode the image bytes; expected a PNG or JPEG image");
		}
		try {
			const image = bound.imageSourceCreateImageAtIndex(source, 0, null);
			if (image === null) {
				throw new Error("cannot decode the image bytes; expected a PNG or JPEG image");
			}
			try {
				return filterByMinimumConfidence(
					recognize(bound, image, options, bound.imageGetWidth(image), bound.imageGetHeight(image)),
					options.minimumConfidence,
				);
			} finally {
				bound.cfRelease(image);
			}
		} finally {
			bound.cfRelease(source);
		}
	} finally {
		bound.cfRelease(data);
	}
}

/** Same as {@link recognizeTextInImage} for a file on disk. */
export function recognizeTextInFile(path: string, options: RecognizeTextOptions = {}): readonly OcrTextObservation[] {
	return recognizeTextInImage(readFileSync(path), options);
}

export interface ImagePixelSize {
	readonly width: number;
	readonly height: number;
}

/**
 * Decoded pixel size of an encoded image. A capture can come back larger than the window that
 * was asked for (Retina backing), so this is the scale a recognised box has to be divided by.
 */
export function readImagePixelSize(imageBytes: Buffer): ImagePixelSize {
	const bound = requireBindings();
	if (imageBytes.byteLength === 0) {
		throw new Error("cannot read the size of an empty image buffer");
	}
	const data = bound.cfDataCreate(null, imageBytes, imageBytes.byteLength);
	if (data === null) {
		throw new Error("cannot copy the image bytes into a CFData");
	}
	try {
		const source = bound.imageSourceCreateWithData(data, null);
		if (source === null) {
			throw new Error("cannot decode the image bytes; expected a PNG or JPEG image");
		}
		try {
			const image = bound.imageSourceCreateImageAtIndex(source, 0, null);
			if (image === null) {
				throw new Error("cannot decode the image bytes; expected a PNG or JPEG image");
			}
			try {
				return { width: bound.imageGetWidth(image), height: bound.imageGetHeight(image) };
			} finally {
				bound.cfRelease(image);
			}
		} finally {
			bound.cfRelease(source);
		}
	} finally {
		bound.cfRelease(data);
	}
}

export function filterByMinimumConfidence(
	observations: readonly OcrTextObservation[],
	minimumConfidence: number | undefined,
): readonly OcrTextObservation[] {
	return minimumConfidence === undefined
		? observations
		: observations.filter((observation) => observation.confidence >= minimumConfidence);
}

function recognize(
	bound: VisionBindings,
	image: Pointer,
	options: RecognizeTextOptions,
	imageWidth: number,
	imageHeight: number,
): OcrTextObservation[] {
	const handler = bound.initHandlerWithImage(
		bound.alloc(bound.imageRequestHandlerClass, bound.selector("alloc")),
		bound.selector("initWithCGImage:options:"),
		image,
		null,
	);
	if (handler === null) {
		throw new Error("VNImageRequestHandler could not be created for this image");
	}

	const request = bound.initTextRequest(
		bound.alloc(bound.recognizeTextRequestClass, bound.selector("alloc")),
		bound.selector("init"),
	);
	try {
		bound.setRecognitionLevel(
			request,
			bound.selector("setRecognitionLevel:"),
			options.level === "fast" ? FAST_LEVEL : ACCURATE_LEVEL,
		);
		bound.setUsesLanguageCorrection(
			request,
			bound.selector("setUsesLanguageCorrection:"),
			options.usesLanguageCorrection ?? options.level !== "fast",
		);
		if (options.languages !== undefined && options.languages.length > 0) {
			bound.setRecognitionLanguages(
				request,
				bound.selector("setRecognitionLanguages:"),
				languageArray(bound, options.languages),
			);
		}

		const requests = bound.arrayWithCapacity(
			bound.alloc(bound.mutableArrayClass, bound.selector("alloc")),
			bound.selector("initWithCapacity:"),
			1,
		);
		if (requests === null) {
			throw new Error("could not build the Vision request list");
		}
		bound.addObject(requests, bound.selector("addObject:"), request);

		const errors: [Pointer | null] = [null];
		if (!bound.performRequests(handler, bound.selector("performRequests:error:"), requests, errors)) {
			throw new Error(`Vision text recognition failed: ${describeError(errors[0])}`);
		}
		bound.release(requests, bound.selector("release"));
		return collectObservations(bound, request, imageWidth, imageHeight);
	} finally {
		bound.release(request, bound.selector("release"));
		bound.release(handler, bound.selector("release"));
	}
}

function collectObservations(
	bound: VisionBindings,
	request: Pointer,
	imageWidth: number,
	imageHeight: number,
): OcrTextObservation[] {
	const results = bound.results(request, bound.selector("results"));
	if (results === null) {
		return [];
	}
	const count = bound.count(results, bound.selector("count"));
	const observations: OcrTextObservation[] = [];
	for (let index = 0; index < count; index += 1) {
		const observation = bound.objectAtIndex(results, bound.selector("objectAtIndex:"), index);
		if (observation === null) {
			continue;
		}
		const candidates = bound.topCandidates(observation, bound.selector("topCandidates:"), 1);
		if (candidates === null || bound.count(candidates, bound.selector("count")) === 0) {
			continue;
		}
		const candidate = bound.objectAtIndex(candidates, bound.selector("objectAtIndex:"), 0);
		if (candidate === null) {
			continue;
		}
		const text = bound.string(candidate, bound.selector("string"));
		if (text === null) {
			continue;
		}
		// Vision reports the box in normalized units with a bottom-left origin. Callers work in
		// image pixels with a top-left origin, so the flip and the scale happen here, once.
		const box = bound.boundingBox(observation, bound.selector("boundingBox"));
		observations.push({
			text: bound.utf8String(text, bound.selector("UTF8String")),
			confidence: bound.confidence(candidate, bound.selector("confidence")),
			box: {
				x: box.x * imageWidth,
				y: (1 - box.y - box.height) * imageHeight,
				width: box.width * imageWidth,
				height: box.height * imageHeight,
			},
		});
	}
	return observations;
}

function languageArray(bound: VisionBindings, languages: readonly string[]): Pointer | null {
	const array = bound.arrayWithCapacity(
		bound.alloc(bound.mutableArrayClass, bound.selector("alloc")),
		bound.selector("initWithCapacity:"),
		languages.length,
	);
	if (array === null) {
		return null;
	}
	for (const language of languages) {
		const value = bound.stringWithUtf8(
			bound.stringClass,
			bound.selector("stringWithUTF8String:"),
			Buffer.from(`${language}\0`, "utf8"),
		);
		if (value !== null) {
			bound.addObject(array, bound.selector("addObject:"), value);
		}
	}
	return array;
}

function describeError(error: Pointer | null): string {
	if (error === null) {
		return "no error object was returned";
	}
	// A bound pointer has no primitive form: String(pointer) throws, so describe it by address.
	const address = koffi.address(error);
	return `NSError at 0x${address.toString(16)}`;
}

function requireBindings(): VisionBindings {
	const bound = bindings();
	if (bound === null) {
		throw new Error("Vision text recognition is unavailable: the Vision framework could not be bound");
	}
	return bound;
}

function bindings(): VisionBindings | null {
	if (cachedBindings === undefined) {
		try {
			cachedBindings = createBindings();
		} catch {
			cachedBindings = null;
		}
	}
	return cachedBindings;
}

function createBindings(): VisionBindings {
	// Loading the framework is what registers VNImageRequestHandler and VNRecognizeTextRequest
	// with the Objective-C runtime, so the load itself is the side effect that matters.
	koffi.load(VISION_FRAMEWORK);
	const imageIo = koffi.load(IMAGE_IO_FRAMEWORK);
	const coreFoundation = koffi.load(CORE_FOUNDATION_FRAMEWORK);
	const objc = koffi.load(LIBOBJC);

	const objcGetClass = objc.func("objc_getClass", "void *", ["str"]) as KoffiFunc<(name: string) => Pointer | null>;
	const selRegisterName = objc.func("sel_registerName", "void *", ["str"]) as KoffiFunc<
		(name: string) => Pointer | null
	>;
	const classForName = (name: string): Pointer => {
		const klass = objcGetClass(name);
		if (klass === null) {
			throw new Error(`Objective-C class not found: ${name}`);
		}
		return klass;
	};
	const selector = (name: string): Pointer => {
		const resolved = selRegisterName(name);
		if (resolved === null) {
			throw new Error(`Objective-C selector not found: ${name}`);
		}
		return resolved;
	};

	// objc_msgSend is one symbol with many signatures; each signature needs its own binding.
	const msgSend = <T extends (...args: never[]) => unknown>(returns: string, parameters: string[]): KoffiFunc<T> =>
		objc.func("objc_msgSend", returns, parameters) as KoffiFunc<T>;

	const boxStruct = koffi.struct("OcrVisionBox", {
		x: "double",
		y: "double",
		width: "double",
		height: "double",
	});

	return {
		cfDataCreate: coreFoundation.func("CFDataCreate", "void *", [
			"void *",
			"uint8_t *",
			"long",
		]) as VisionBindings["cfDataCreate"],
		cfRelease: coreFoundation.func("CFRelease", "void", ["void *"]) as VisionBindings["cfRelease"],
		imageSourceCreateWithData: imageIo.func("CGImageSourceCreateWithData", "void *", [
			"void *",
			"void *",
		]) as VisionBindings["imageSourceCreateWithData"],
		imageSourceCreateImageAtIndex: imageIo.func("CGImageSourceCreateImageAtIndex", "void *", [
			"void *",
			"ulong",
			"void *",
		]) as VisionBindings["imageSourceCreateImageAtIndex"],
		imageGetWidth: imageIo.func("CGImageGetWidth", "ulong", ["void *"]) as VisionBindings["imageGetWidth"],
		imageGetHeight: imageIo.func("CGImageGetHeight", "ulong", ["void *"]) as VisionBindings["imageGetHeight"],
		classForName,
		selector,
		imageRequestHandlerClass: classForName("VNImageRequestHandler"),
		recognizeTextRequestClass: classForName("VNRecognizeTextRequest"),
		mutableArrayClass: classForName("NSMutableArray"),
		stringClass: classForName("NSString"),
		alloc: msgSend<VisionBindings["alloc"]>("void *", ["void *", "void *"]),
		initTextRequest: msgSend<VisionBindings["initTextRequest"]>("void *", ["void *", "void *"]),
		initHandlerWithImage: msgSend<VisionBindings["initHandlerWithImage"]>("void *", [
			"void *",
			"void *",
			"void *",
			"void *",
		]),
		setRecognitionLevel: msgSend<VisionBindings["setRecognitionLevel"]>("void", ["void *", "void *", "int64_t"]),
		setUsesLanguageCorrection: msgSend<VisionBindings["setUsesLanguageCorrection"]>("void", [
			"void *",
			"void *",
			"bool",
		]),
		setRecognitionLanguages: msgSend<VisionBindings["setRecognitionLanguages"]>("void", [
			"void *",
			"void *",
			"void *",
		]),
		arrayWithCapacity: msgSend<VisionBindings["arrayWithCapacity"]>("void *", ["void *", "void *", "ulong"]),
		addObject: msgSend<VisionBindings["addObject"]>("void", ["void *", "void *", "void *"]),
		stringWithUtf8: msgSend<VisionBindings["stringWithUtf8"]>("void *", ["void *", "void *", "void *"]),
		performRequests: objc.func("objc_msgSend", "bool", [
			"void *",
			"void *",
			"void *",
			koffi.out(koffi.pointer("void *")),
		]) as VisionBindings["performRequests"],
		release: msgSend<VisionBindings["release"]>("void", ["void *", "void *"]),
		results: msgSend<VisionBindings["results"]>("void *", ["void *", "void *"]),
		count: msgSend<VisionBindings["count"]>("ulong", ["void *", "void *"]),
		objectAtIndex: msgSend<VisionBindings["objectAtIndex"]>("void *", ["void *", "void *", "ulong"]),
		boundingBox: objc.func("objc_msgSend", boxStruct, ["void *", "void *"]) as VisionBindings["boundingBox"],
		topCandidates: msgSend<VisionBindings["topCandidates"]>("void *", ["void *", "void *", "ulong"]),
		string: msgSend<VisionBindings["string"]>("void *", ["void *", "void *"]),
		utf8String: msgSend<VisionBindings["utf8String"]>("str", ["void *", "void *"]),
		confidence: msgSend<VisionBindings["confidence"]>("float", ["void *", "void *"]),
	};
}

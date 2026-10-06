// sckit.m — ScreenCaptureKit FFI shim for @apple-cua/core
//
// Build: see build.sh in the same directory.
//
// Public entry points:
//   sck_capture_supported() -> int   (1 when this macOS has the screenshot API below, else 0)
//   sck_capture_main_display_png(w, h, **outBytes, *outLen, *outW, *outH) -> int
//   sckit_capture_window(windowId, maxW, maxH, format, quality, *outLen) -> *bytes
//   sck_free(*bytes) -> void
//   sck_invalidate_cache() -> void   (call after display config change)
//
// Availability: the library loads on macOS 12.3 (ScreenCaptureKit itself), but SCScreenshotManager and
// SCContentFilter's geometry arrived in macOS 14.0. Below that the capture calls return SCK_ERR_UNAVAILABLE
// (or NULL) without touching those APIs, and the caller uses its CoreGraphics or screencapture fallback.
//
// Memory: returned bytes are malloc'd; caller MUST call sck_free.

#import <CoreFoundation/CoreFoundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <limits.h>
#import <math.h>
#import <stdatomic.h>
#import <stdint.h>
#import <stdlib.h>
#import <string.h>

#define SCK_OK 0
#define SCK_ERR_NO_SHAREABLE_CONTENT -1
#define SCK_ERR_NO_DISPLAY -2
#define SCK_ERR_CAPTURE_FAILED -3
#define SCK_ERR_ENCODE_FAILED -4
#define SCK_ERR_INVALID_ARGS -5
#define SCK_ERR_TIMEOUT -6
#define SCK_ERR_UNAVAILABLE -7

#define SCK_WINDOW_FORMAT_PNG 0
#define SCK_WINDOW_FORMAT_JPEG 1

static const int64_t SCK_TIMEOUT_NANOSECONDS = 5LL * NSEC_PER_SEC;
static const NSTimeInterval SCK_WINDOW_TIMEOUT_SECONDS = 3.0;
static const NSTimeInterval SCK_WINDOW_CACHE_TTL_SECONDS = 2.0;
static const NSUInteger SCK_WINDOW_CACHE_CAPACITY = 32;
static CFStringRef kSckPngUTI = CFSTR("public.png");
static CFStringRef kSckJpegUTI = CFSTR("public.jpeg");

static SCContentFilter *cachedFilter = nil;
static CGDirectDisplayID cachedFilterDisplayID = 0;

static dispatch_queue_t filterCacheQueue(void) {
	static dispatch_queue_t queue = nil;
	static dispatch_once_t once;
	dispatch_once(&once, ^{
		queue = dispatch_queue_create(
			"com.macoscua.sckit.filter-cache", DISPATCH_QUEUE_SERIAL);
	});
	return queue;
}

static SCContentFilter *resolveMainDisplayFilter(int *errorOut) {
	__block SCContentFilter *resolved = nil;
	__block int error = SCK_OK;

	dispatch_sync(filterCacheQueue(), ^{
		CGDirectDisplayID mainID = CGMainDisplayID();
		if (cachedFilter != nil && cachedFilterDisplayID == mainID) {
			resolved = cachedFilter;
			return;
		}

		dispatch_semaphore_t shareableDone = dispatch_semaphore_create(0);
		__block SCDisplay *targetDisplay = nil;

		[SCShareableContent
			getShareableContentExcludingDesktopWindows:NO
			onScreenWindowsOnly:NO
			completionHandler:^(SCShareableContent *content, NSError *shareableError) {
				if (shareableError == nil && content != nil) {
					for (SCDisplay *display in content.displays) {
						if (display.displayID == mainID) {
							targetDisplay = display;
							break;
						}
					}
					if (targetDisplay == nil) {
						targetDisplay = content.displays.firstObject;
					}
				}
				dispatch_semaphore_signal(shareableDone);
			}];

		dispatch_time_t shareableDeadline = dispatch_time(
			DISPATCH_TIME_NOW, SCK_TIMEOUT_NANOSECONDS);
		if (dispatch_semaphore_wait(shareableDone, shareableDeadline) != 0) {
			error = SCK_ERR_TIMEOUT;
			return;
		}
		if (targetDisplay == nil) {
			error = SCK_ERR_NO_DISPLAY;
			return;
		}

		cachedFilter = [[SCContentFilter alloc]
			initWithDisplay:targetDisplay
			excludingWindows:@[]];
		cachedFilterDisplayID = mainID;
		resolved = cachedFilter;
	});

	if (errorOut != NULL) {
		*errorOut = error;
	}
	return resolved;
}

static NSData *encodeCGImageAsPNG(CGImageRef image, int maxPixelSize) {
	if (image == NULL) {
		return nil;
	}
	NSMutableData *data = [NSMutableData data];
	CGImageDestinationRef destination = CGImageDestinationCreateWithData(
		(__bridge CFMutableDataRef)data, kSckPngUTI, 1, NULL);
	if (destination == NULL) {
		return nil;
	}
	NSDictionary *properties = @{
		(__bridge NSString *)kCGImageDestinationImageMaxPixelSize: @(maxPixelSize),
	};
	CGImageDestinationAddImage(destination, image, (__bridge CFDictionaryRef)properties);
	BOOL finalized = CGImageDestinationFinalize(destination);
	CFRelease(destination);
	if (!finalized || data.length == 0) {
		return nil;
	}
	return data;
}

int sck_capture_supported(void) {
	if (@available(macOS 14.0, *)) {
		return 1;
	}
	return 0;
}

static int captureMainDisplayPng(
	int targetPixelWidth,
	int targetPixelHeight,
	uint8_t **outBytes,
	size_t *outLen,
	int *outWidth,
	int *outHeight) API_AVAILABLE(macos(14.0));

int sck_capture_main_display_png(
	int targetPixelWidth,
	int targetPixelHeight,
	uint8_t **outBytes,
	size_t *outLen,
	int *outWidth,
	int *outHeight) {
	if (outBytes == NULL || outLen == NULL || outWidth == NULL || outHeight == NULL) {
		return SCK_ERR_INVALID_ARGS;
	}
	if (targetPixelWidth <= 0 || targetPixelHeight <= 0) {
		return SCK_ERR_INVALID_ARGS;
	}
	*outBytes = NULL;
	*outLen = 0;
	*outWidth = 0;
	*outHeight = 0;

	if (@available(macOS 14.0, *)) {
		return captureMainDisplayPng(
			targetPixelWidth, targetPixelHeight, outBytes, outLen, outWidth, outHeight);
	}
	return SCK_ERR_UNAVAILABLE;
}

static int captureMainDisplayPng(
	int targetPixelWidth,
	int targetPixelHeight,
	uint8_t **outBytes,
	size_t *outLen,
	int *outWidth,
	int *outHeight) {
	int resolveError = SCK_OK;
	SCContentFilter *filter = resolveMainDisplayFilter(&resolveError);
	if (filter == nil) {
		return resolveError == SCK_OK ? SCK_ERR_NO_SHAREABLE_CONTENT : resolveError;
	}

	int maxPixelSize = targetPixelWidth > targetPixelHeight ? targetPixelWidth : targetPixelHeight;

	SCStreamConfiguration *config = [[SCStreamConfiguration alloc] init];
	config.width = (size_t)targetPixelWidth;
	config.height = (size_t)targetPixelHeight;
	config.showsCursor = YES;
	config.scalesToFit = YES;
	config.pixelFormat = kCVPixelFormatType_32BGRA;

	__block int resultCode = SCK_ERR_CAPTURE_FAILED;
	__block NSData *encodedData = nil;
	__block int producedWidth = 0;
	__block int producedHeight = 0;
	dispatch_semaphore_t captureDone = dispatch_semaphore_create(0);

	[SCScreenshotManager
		captureImageWithFilter:filter
		configuration:config
		completionHandler:^(CGImageRef image, NSError *captureError) {
			if (captureError != nil || image == NULL) {
				resultCode = SCK_ERR_CAPTURE_FAILED;
				dispatch_semaphore_signal(captureDone);
				return;
			}
			producedWidth = (int)CGImageGetWidth(image);
			producedHeight = (int)CGImageGetHeight(image);
			encodedData = encodeCGImageAsPNG(image, maxPixelSize);
			resultCode = (encodedData != nil) ? SCK_OK : SCK_ERR_ENCODE_FAILED;
			dispatch_semaphore_signal(captureDone);
		}];

	dispatch_time_t captureDeadline = dispatch_time(DISPATCH_TIME_NOW, SCK_TIMEOUT_NANOSECONDS);
	if (dispatch_semaphore_wait(captureDone, captureDeadline) != 0) {
		return SCK_ERR_TIMEOUT;
	}
	if (resultCode != SCK_OK || encodedData == nil) {
		return resultCode;
	}

	size_t encodedLength = encodedData.length;
	uint8_t *encodedBuffer = (uint8_t *)malloc(encodedLength);
	if (encodedBuffer == NULL) {
		return SCK_ERR_ENCODE_FAILED;
	}
	memcpy(encodedBuffer, encodedData.bytes, encodedLength);

	*outBytes = encodedBuffer;
	*outLen = encodedLength;
	*outWidth = producedWidth;
	*outHeight = producedHeight;
	return SCK_OK;
}

@interface SCKWindowIdentity : NSObject
@property(nonatomic) pid_t ownerPID;
@property(nonatomic) NSInteger layer;
@property(nonatomic) CGRect frame;
@end
@implementation SCKWindowIdentity
@end

@interface SCKWindowCapturePlan : NSObject
@property(nonatomic, strong) SCContentFilter *filter;
@property(nonatomic, strong) SCStreamConfiguration *configuration;
@property(nonatomic, strong) SCKWindowIdentity *identity;
@property(nonatomic) int32_t maxWidth;
@property(nonatomic) int32_t maxHeight;
@property(nonatomic) NSTimeInterval createdAt;
@end
@implementation SCKWindowCapturePlan
@end

@interface SCKWindowCaptureResult : NSObject
@property(nonatomic, strong) NSData *data;
@end
@implementation SCKWindowCaptureResult
@end

@interface SCKWindowOperationState : NSObject {
@public
	atomic_int pendingCallbacks;
	atomic_bool workerFinished;
	atomic_bool gateReleased;
}
@end
@implementation SCKWindowOperationState
- (instancetype)init {
	self = [super init];
	if (self != nil) {
		atomic_init(&pendingCallbacks, 0);
		atomic_init(&workerFinished, false);
		atomic_init(&gateReleased, false);
	}
	return self;
}
@end

static NSMutableDictionary<NSNumber *, SCKWindowCapturePlan *> *windowPlanCache;
static atomic_bool windowCaptureActive = false;

static void releaseWindowCaptureGateIfFinished(SCKWindowOperationState *state) {
	if (!atomic_load(&state->workerFinished) || atomic_load(&state->pendingCallbacks) != 0) {
		return;
	}
	bool expected = false;
	if (atomic_compare_exchange_strong(&state->gateReleased, &expected, true)) {
		atomic_store(&windowCaptureActive, false);
	}
}

static void windowCallbackStarted(SCKWindowOperationState *state) {
	atomic_fetch_add(&state->pendingCallbacks, 1);
}

static void windowCallbackFinished(SCKWindowOperationState *state) {
	atomic_fetch_sub(&state->pendingCallbacks, 1);
	releaseWindowCaptureGateIfFinished(state);
}

static dispatch_queue_t windowCacheQueue(void) {
	static dispatch_queue_t queue = nil;
	static dispatch_once_t once;
	dispatch_once(&once, ^{
		queue = dispatch_queue_create("com.macoscua.sckit.window-cache", DISPATCH_QUEUE_SERIAL);
		windowPlanCache = [NSMutableDictionary dictionary];
	});
	return queue;
}

static dispatch_queue_t windowWorkerQueue(void) {
	static dispatch_queue_t queue = nil;
	static dispatch_once_t once;
	dispatch_once(&once, ^{
		queue = dispatch_queue_create("com.macoscua.sckit.window-capture", DISPATCH_QUEUE_SERIAL);
	});
	return queue;
}

static BOOL identitiesEqual(SCKWindowIdentity *left, SCKWindowIdentity *right) {
	return left != nil && right != nil && left.ownerPID == right.ownerPID &&
		left.layer == right.layer && CGRectEqualToRect(left.frame, right.frame);
}

static SCKWindowIdentity *currentWindowIdentity(uint32_t windowID) {
	CFArrayRef infoRef = CGWindowListCopyWindowInfo(
		kCGWindowListOptionIncludingWindow, (CGWindowID)windowID);
	if (infoRef == NULL) {
		return nil;
	}
	NSArray<NSDictionary *> *info = CFBridgingRelease(infoRef);
	for (NSDictionary *entry in info) {
		NSNumber *listedID = entry[(id)kCGWindowNumber];
		NSNumber *ownerPID = entry[(id)kCGWindowOwnerPID];
		NSNumber *layer = entry[(id)kCGWindowLayer];
		NSDictionary *bounds = entry[(id)kCGWindowBounds];
		CGRect frame = CGRectZero;
		if (listedID.unsignedIntValue != windowID || ownerPID == nil || layer == nil ||
			bounds == nil || !CGRectMakeWithDictionaryRepresentation(
				(__bridge CFDictionaryRef)bounds, &frame) || !isfinite(frame.origin.x) ||
			!isfinite(frame.origin.y) || !isfinite(frame.size.width) ||
			!isfinite(frame.size.height) || frame.size.width <= 0 || frame.size.height <= 0) {
			continue;
		}
		SCKWindowIdentity *identity = [[SCKWindowIdentity alloc] init];
		identity.ownerPID = ownerPID.intValue;
		identity.layer = layer.integerValue;
		identity.frame = frame;
		return identity;
	}
	return nil;
}

static void evictWindowPlan(uint32_t windowID) {
	dispatch_sync(windowCacheQueue(), ^{
		[windowPlanCache removeObjectForKey:@(windowID)];
	});
}

static SCKWindowCapturePlan *cachedWindowPlan(
	uint32_t windowID,
	int32_t maxWidth,
	int32_t maxHeight,
	SCKWindowIdentity *identity) {
	__block SCKWindowCapturePlan *plan = nil;
	NSTimeInterval now = [NSDate timeIntervalSinceReferenceDate];
	dispatch_sync(windowCacheQueue(), ^{
		NSArray<NSNumber *> *keys = windowPlanCache.allKeys;
		for (NSNumber *key in keys) {
			if (now - windowPlanCache[key].createdAt >= SCK_WINDOW_CACHE_TTL_SECONDS) {
				[windowPlanCache removeObjectForKey:key];
			}
		}
		SCKWindowCapturePlan *candidate = windowPlanCache[@(windowID)];
		if (candidate != nil && candidate.maxWidth == maxWidth &&
			candidate.maxHeight == maxHeight && identitiesEqual(candidate.identity, identity)) {
			plan = candidate;
		} else if (candidate != nil) {
			[windowPlanCache removeObjectForKey:@(windowID)];
		}
	});
	return plan;
}

static void storeWindowPlan(uint32_t windowID, SCKWindowCapturePlan *plan) {
	dispatch_sync(windowCacheQueue(), ^{
		if (windowPlanCache.count >= SCK_WINDOW_CACHE_CAPACITY &&
			windowPlanCache[@(windowID)] == nil) {
			NSNumber *oldestKey = nil;
			NSTimeInterval oldestTime = DBL_MAX;
			for (NSNumber *key in windowPlanCache) {
				NSTimeInterval createdAt = windowPlanCache[key].createdAt;
				if (createdAt < oldestTime) {
					oldestTime = createdAt;
					oldestKey = key;
				}
			}
			if (oldestKey != nil) {
				[windowPlanCache removeObjectForKey:oldestKey];
			}
		}
		windowPlanCache[@(windowID)] = plan;
	});
}

static dispatch_time_t remainingDeadline(NSTimeInterval startedAt) {
	NSTimeInterval remaining = SCK_WINDOW_TIMEOUT_SECONDS -
		([NSDate timeIntervalSinceReferenceDate] - startedAt);
	if (remaining <= 0) {
		return DISPATCH_TIME_NOW;
	}
	return dispatch_time(DISPATCH_TIME_NOW, (int64_t)(remaining * NSEC_PER_SEC));
}

static SCKWindowCapturePlan *buildWindowPlan(
	uint32_t windowID,
	int32_t maxWidth,
	int32_t maxHeight,
	SCKWindowIdentity *expectedIdentity,
	NSTimeInterval startedAt,
	SCKWindowOperationState *operationState) API_AVAILABLE(macos(14.0));

static SCKWindowCapturePlan *buildWindowPlan(
	uint32_t windowID,
	int32_t maxWidth,
	int32_t maxHeight,
	SCKWindowIdentity *expectedIdentity,
	NSTimeInterval startedAt,
	SCKWindowOperationState *operationState) {
	__block SCShareableContent *shareableContent = nil;
	dispatch_semaphore_t done = dispatch_semaphore_create(0);
	windowCallbackStarted(operationState);
	[SCShareableContent
		getShareableContentExcludingDesktopWindows:NO
		onScreenWindowsOnly:NO
		completionHandler:^(SCShareableContent *content, NSError *error) {
			if (error == nil) {
				shareableContent = content;
			}
			dispatch_semaphore_signal(done);
			windowCallbackFinished(operationState);
		}];
	if (dispatch_semaphore_wait(done, remainingDeadline(startedAt)) != 0 ||
		shareableContent == nil) {
		return nil;
	}

	SCWindow *targetWindow = nil;
	for (SCWindow *window in shareableContent.windows) {
		if (window.windowID == windowID) {
			targetWindow = window;
			break;
		}
	}
	if (targetWindow == nil || targetWindow.owningApplication == nil) {
		return nil;
	}
	SCKWindowIdentity *shareableIdentity = [[SCKWindowIdentity alloc] init];
	shareableIdentity.ownerPID = targetWindow.owningApplication.processID;
	shareableIdentity.layer = targetWindow.windowLayer;
	shareableIdentity.frame = targetWindow.frame;
	if (!identitiesEqual(expectedIdentity, shareableIdentity)) {
		return nil;
	}

	SCContentFilter *filter = [[SCContentFilter alloc]
		initWithDesktopIndependentWindow:targetWindow];
	CGRect contentRect = filter.contentRect;
	if (!isfinite(contentRect.size.width) || !isfinite(contentRect.size.height) ||
		contentRect.size.width <= 0 || contentRect.size.height <= 0) {
		contentRect = targetWindow.frame;
	}
	double nativeWidth = round(contentRect.size.width * filter.pointPixelScale);
	double nativeHeight = round(contentRect.size.height * filter.pointPixelScale);
	if (!isfinite(nativeWidth) || !isfinite(nativeHeight) || nativeWidth < 1 ||
		nativeHeight < 1) {
		return nil;
	}
	double scale = fmin(1.0, fmin((double)maxWidth / nativeWidth,
		(double)maxHeight / nativeHeight));
	size_t outputWidth = (size_t)fmax(1.0, round(nativeWidth * scale));
	size_t outputHeight = (size_t)fmax(1.0, round(nativeHeight * scale));

	SCStreamConfiguration *configuration = [[SCStreamConfiguration alloc] init];
	configuration.width = outputWidth;
	configuration.height = outputHeight;
	configuration.showsCursor = NO;
	configuration.scalesToFit = YES;
	configuration.pixelFormat = kCVPixelFormatType_32BGRA;

	SCKWindowCapturePlan *plan = [[SCKWindowCapturePlan alloc] init];
	plan.filter = filter;
	plan.configuration = configuration;
	plan.identity = expectedIdentity;
	plan.maxWidth = maxWidth;
	plan.maxHeight = maxHeight;
	plan.createdAt = [NSDate timeIntervalSinceReferenceDate];
	return plan;
}

static NSData *encodeWindowImage(CGImageRef image, int32_t format, int32_t quality) {
	if (image == NULL) {
		return nil;
	}
	NSMutableData *data = [NSMutableData data];
	CFStringRef type = format == SCK_WINDOW_FORMAT_JPEG ? kSckJpegUTI : kSckPngUTI;
	CGImageDestinationRef destination = CGImageDestinationCreateWithData(
		(__bridge CFMutableDataRef)data, type, 1, NULL);
	if (destination == NULL) {
		return nil;
	}
	NSDictionary *properties = format == SCK_WINDOW_FORMAT_JPEG
		? @{(__bridge NSString *)kCGImageDestinationLossyCompressionQuality:
			  @((double)quality / 100.0)}
		: @{};
	CGImageDestinationAddImage(destination, image, (__bridge CFDictionaryRef)properties);
	BOOL finalized = CGImageDestinationFinalize(destination);
	CFRelease(destination);
	return finalized && data.length > 0 ? data : nil;
}

static NSData *captureWindowData(
	uint32_t windowID,
	int32_t maxWidth,
	int32_t maxHeight,
	int32_t format,
	int32_t quality,
	NSTimeInterval startedAt,
	SCKWindowOperationState *operationState) API_AVAILABLE(macos(14.0));

static NSData *captureWindowData(
	uint32_t windowID,
	int32_t maxWidth,
	int32_t maxHeight,
	int32_t format,
	int32_t quality,
	NSTimeInterval startedAt,
	SCKWindowOperationState *operationState) {
	SCKWindowIdentity *identity = currentWindowIdentity(windowID);
	if (identity == nil) {
		return nil;
	}
	SCKWindowCapturePlan *plan = cachedWindowPlan(
		windowID, maxWidth, maxHeight, identity);
	if (plan == nil) {
		plan = buildWindowPlan(
			windowID, maxWidth, maxHeight, identity, startedAt, operationState);
		if (plan == nil) {
			evictWindowPlan(windowID);
			return nil;
		}
		storeWindowPlan(windowID, plan);
	}

	__block NSData *encoded = nil;
	__block BOOL captureSucceeded = NO;
	dispatch_semaphore_t done = dispatch_semaphore_create(0);
	windowCallbackStarted(operationState);
	[SCScreenshotManager
		captureImageWithFilter:plan.filter
		configuration:plan.configuration
		completionHandler:^(CGImageRef image, NSError *error) {
			if (error == nil && image != NULL) {
				encoded = encodeWindowImage(image, format, quality);
				captureSucceeded = encoded != nil;
			}
			dispatch_semaphore_signal(done);
			windowCallbackFinished(operationState);
		}];
	if (dispatch_semaphore_wait(done, remainingDeadline(startedAt)) != 0 ||
		!captureSucceeded) {
		evictWindowPlan(windowID);
		return nil;
	}
	SCKWindowIdentity *identityAfterCapture = currentWindowIdentity(windowID);
	if (!identitiesEqual(identity, identityAfterCapture)) {
		evictWindowPlan(windowID);
		return nil;
	}
	return encoded;
}

static uint8_t *captureWindow(
	uint32_t windowId,
	int32_t maxWidth,
	int32_t maxHeight,
	int32_t format,
	int32_t quality,
	int32_t *outLen) API_AVAILABLE(macos(14.0));

uint8_t *sckit_capture_window(
	uint32_t windowId,
	int32_t maxWidth,
	int32_t maxHeight,
	int32_t format,
	int32_t quality,
	int32_t *outLen) {
	if (outLen == NULL) {
		return NULL;
	}
	*outLen = 0;
	if (windowId == 0 || maxWidth <= 0 || maxHeight <= 0 ||
		(format != SCK_WINDOW_FORMAT_PNG && format != SCK_WINDOW_FORMAT_JPEG) ||
		quality < 1 || quality > 100) {
		return NULL;
	}
	if (@available(macOS 14.0, *)) {
		return captureWindow(windowId, maxWidth, maxHeight, format, quality, outLen);
	}
	return NULL;
}

static uint8_t *captureWindow(
	uint32_t windowId,
	int32_t maxWidth,
	int32_t maxHeight,
	int32_t format,
	int32_t quality,
	int32_t *outLen) {
	bool expected = false;
	if (!atomic_compare_exchange_strong(&windowCaptureActive, &expected, true)) {
		return NULL;
	}

	NSTimeInterval startedAt = [NSDate timeIntervalSinceReferenceDate];
	SCKWindowCaptureResult *result = [[SCKWindowCaptureResult alloc] init];
	SCKWindowOperationState *operationState = [[SCKWindowOperationState alloc] init];
	dispatch_semaphore_t done = dispatch_semaphore_create(0);
	dispatch_async(windowWorkerQueue(), ^{
		@autoreleasepool {
			result.data = captureWindowData(
				windowId, maxWidth, maxHeight, format, quality, startedAt, operationState);
			atomic_store(&operationState->workerFinished, true);
			releaseWindowCaptureGateIfFinished(operationState);
			dispatch_semaphore_signal(done);
		}
	});

	if (dispatch_semaphore_wait(done, remainingDeadline(startedAt)) != 0) {
		return NULL;
	}
	NSData *data = result.data;
	if (data.length == 0 || data.length > INT32_MAX) {
		return NULL;
	}
	uint8_t *buffer = malloc(data.length);
	if (buffer == NULL) {
		return NULL;
	}
	memcpy(buffer, data.bytes, data.length);
	*outLen = (int32_t)data.length;
	return buffer;
}

void sck_free(uint8_t *bytes) {
	if (bytes != NULL) {
		free(bytes);
	}
}

void sck_invalidate_cache(void) {
	dispatch_sync(filterCacheQueue(), ^{
		cachedFilter = nil;
		cachedFilterDisplayID = 0;
	});
	dispatch_sync(windowCacheQueue(), ^{
		[windowPlanCache removeAllObjects];
	});
}

// sckit.m — ScreenCaptureKit FFI shim for @macos-cua/core
//
// Build: see build.sh in the same directory.
//
// Public entry points:
//   sck_capture_main_display_png(w, h, **outBytes, *outLen, *outW, *outH) -> int
//   sck_free(*bytes) -> void
//   sck_invalidate_cache() -> void   (call after display config change)
//
// Memory: *outBytes is malloc'd, caller MUST free() it (or call sck_free).
//
// Caching: SCContentFilter is expensive to build (requires SCShareableContent
// discovery, ~80-200ms cold start) and rarely changes. We resolve it once,
// lazily, and reuse across screenshots. sck_invalidate_cache() forces a
// rebuild on the next call.

#import <CoreFoundation/CoreFoundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
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

static const int64_t SCK_TIMEOUT_NANOSECONDS = 5LL * NSEC_PER_SEC;
static CFStringRef kSckPngUTI = CFSTR("public.png");

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
}

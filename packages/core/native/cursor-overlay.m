#import <Cocoa/Cocoa.h>
#import <pthread.h>

static NSWindow *gWindow = nil;
static BOOL gShown = NO;
static NSTimer *gScootTimer = nil;
static NSPoint gScootFrom;
static NSPoint gScootTo;
static NSTimeInterval gScootStart;

static const CGFloat kOverlaySize = 40.0;
static const NSTimeInterval kFadeInDuration = 0.18;
static const NSTimeInterval kScootDuration = 0.16;
static const CGFloat kRingRadius = 9.0;
static const CGFloat kCoreRadius = 6.0;

@interface OverlayPointerView : NSView
@end

@implementation OverlayPointerView
- (BOOL)isFlipped {
	return YES;
}
- (void)drawRect:(NSRect)dirtyRect {
	(void)dirtyRect;
	NSRect bounds = self.bounds;
	CGFloat cx = NSWidth(bounds) / 2.0;
	CGFloat cy = NSHeight(bounds) / 2.0;
	NSBezierPath *ring = [NSBezierPath
		bezierPathWithOvalInRect:NSMakeRect(cx - kRingRadius, cy - kRingRadius, kRingRadius * 2, kRingRadius * 2)];
	[[NSColor colorWithSRGBRed:1.0 green:1.0 blue:1.0 alpha:1.0] setFill];
	[ring fill];
	NSBezierPath *core = [NSBezierPath
		bezierPathWithOvalInRect:NSMakeRect(cx - kCoreRadius, cy - kCoreRadius, kCoreRadius * 2, kCoreRadius * 2)];
	[[NSColor colorWithSRGBRed:1.0 green:0.231 blue:0.188 alpha:1.0] setFill];
	[core fill];
}
@end

static CGFloat primary_screen_height(void) {
	NSArray<NSScreen *> *screens = [NSScreen screens];
	if (screens.count == 0) {
		return 0.0;
	}
	return NSHeight([screens[0] frame]);
}

static void apply_set(double x, double y) {
	if (gWindow == nil) {
		return;
	}
	CGFloat screenHeight = primary_screen_height();
	NSPoint target = NSMakePoint(x - kOverlaySize / 2.0, screenHeight - y - kOverlaySize / 2.0);
	if (!gShown) {
		gShown = YES;
		[gWindow setAlphaValue:0.0];
		[gWindow setFrameOrigin:target];
		[gWindow orderFrontRegardless];
		[NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) {
			context.duration = kFadeInDuration;
			[[gWindow animator] setAlphaValue:1.0];
		}
							completionHandler:nil];
		return;
	}
	[gWindow orderFrontRegardless];
	if (gScootTimer != nil) {
		[gScootTimer invalidate];
		gScootTimer = nil;
	}
	gScootFrom = gWindow.frame.origin;
	gScootTo = target;
	gScootStart = [NSDate timeIntervalSinceReferenceDate];
	gScootTimer = [NSTimer scheduledTimerWithTimeInterval:1.0 / 60.0
												  repeats:YES
													block:^(NSTimer *timer) {
														double progress =
															([NSDate timeIntervalSinceReferenceDate] - gScootStart) / kScootDuration;
														if (progress > 1.0) {
															progress = 1.0;
														}
														double eased = progress < 0.5
																		   ? 2.0 * progress * progress
																		   : 1.0 - pow(-2.0 * progress + 2.0, 2.0) / 2.0;
														[gWindow setFrameOrigin:NSMakePoint(
																				   gScootFrom.x + (gScootTo.x - gScootFrom.x) * eased,
																				   gScootFrom.y + (gScootTo.y - gScootFrom.y) * eased)];
														if (progress >= 1.0) {
															[timer invalidate];
															if (gScootTimer == timer) {
																gScootTimer = nil;
															}
														}
													}];
}

static void apply_hide(void) {
	if (gScootTimer != nil) {
		[gScootTimer invalidate];
		gScootTimer = nil;
	}
	if (gWindow != nil) {
		[gWindow orderOut:nil];
		gShown = NO;
	}
}

static void *stdin_reader(void *arg) {
	(void)arg;
	char line[256];
	while (fgets(line, sizeof(line), stdin) != NULL) {
		double x = 0.0;
		double y = 0.0;
		if (sscanf(line, "set %lf %lf", &x, &y) == 2) {
			dispatch_async(dispatch_get_main_queue(), ^{
				apply_set(x, y);
			});
		} else if (strncmp(line, "hide", 4) == 0) {
			dispatch_async(dispatch_get_main_queue(), ^{
				apply_hide();
			});
		} else if (strncmp(line, "quit", 4) == 0) {
			break;
		}
	}
	dispatch_async(dispatch_get_main_queue(), ^{
		[NSApp terminate:nil];
	});
	return NULL;
}

int main(int argc, const char *argv[]) {
	(void)argc;
	(void)argv;
	@autoreleasepool {
		[NSApplication sharedApplication];
		[NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];

		NSRect frame = NSMakeRect(0, 0, kOverlaySize, kOverlaySize);
		gWindow = [[NSWindow alloc] initWithContentRect:frame
											  styleMask:NSWindowStyleMaskBorderless
												backing:NSBackingStoreBuffered
												  defer:NO];
		[gWindow setOpaque:NO];
		[gWindow setBackgroundColor:[NSColor clearColor]];
		[gWindow setHasShadow:NO];
		[gWindow setIgnoresMouseEvents:YES];
		[gWindow setLevel:NSScreenSaverWindowLevel];
		[gWindow setCollectionBehavior:NSWindowCollectionBehaviorCanJoinAllSpaces |
									   NSWindowCollectionBehaviorStationary | NSWindowCollectionBehaviorIgnoresCycle];
		[gWindow setContentView:[[OverlayPointerView alloc] initWithFrame:frame]];

		pthread_t thread;
		pthread_create(&thread, NULL, stdin_reader, NULL);
		pthread_detach(thread);

		[NSApp run];
	}
	return 0;
}

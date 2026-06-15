#import <Cocoa/Cocoa.h>
#import <pthread.h>

static NSWindow *gWindow = nil;
static NSView *gPointerView = nil;
static NSWindow *gHighlightWindow = nil;
static NSTimer *gHighlightTimer = nil;
static BOOL gShown = NO;
static NSTimer *gScootTimer = nil;
static NSPoint gScootFrom;
static NSPoint gScootTo;
static NSTimeInterval gScootStart;
static CGFloat gStretch = 1.0;
static CGFloat gAngle = 0.0;

static const CGFloat kOverlaySize = 40.0;
static const NSTimeInterval kFadeInDuration = 0.18;
static const NSTimeInterval kScootDuration = 0.16;
static const CGFloat kRingRadius = 9.0;
static const CGFloat kCoreRadius = 6.0;
static const CGFloat kMaxStretch = 0.38;

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
	CGContextRef ctx = NSGraphicsContext.currentContext.CGContext;
	CGContextSaveGState(ctx);
	CGContextTranslateCTM(ctx, cx, cy);
	CGContextRotateCTM(ctx, gAngle);
	CGContextScaleCTM(ctx, gStretch, 1.0 / gStretch);
	CGContextRotateCTM(ctx, -gAngle);
	CGContextTranslateCTM(ctx, -cx, -cy);
	NSBezierPath *ring = [NSBezierPath
		bezierPathWithOvalInRect:NSMakeRect(cx - kRingRadius, cy - kRingRadius, kRingRadius * 2, kRingRadius * 2)];
	[[NSColor colorWithSRGBRed:1.0 green:1.0 blue:1.0 alpha:1.0] setFill];
	[ring fill];
	NSBezierPath *core = [NSBezierPath
		bezierPathWithOvalInRect:NSMakeRect(cx - kCoreRadius, cy - kCoreRadius, kCoreRadius * 2, kCoreRadius * 2)];
	[[NSColor colorWithSRGBRed:1.0 green:0.231 blue:0.188 alpha:1.0] setFill];
	[core fill];
	CGContextRestoreGState(ctx);
}
@end

@interface HighlightView : NSView
@end

@implementation HighlightView
- (void)drawRect:(NSRect)dirtyRect {
	(void)dirtyRect;
	NSRect inset = NSInsetRect(self.bounds, 3.0, 3.0);
	NSBezierPath *outline = [NSBezierPath bezierPathWithRoundedRect:inset xRadius:12.0 yRadius:12.0];
	[outline setLineWidth:5.0];
	[[NSColor colorWithSRGBRed:0.39 green:0.78 blue:1.0 alpha:0.9] setStroke];
	[outline stroke];
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
	gAngle = atan2(gScootTo.y - gScootFrom.y, gScootTo.x - gScootFrom.x);
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
														gStretch = 1.0 + kMaxStretch * sin(progress * M_PI);
														[gPointerView setNeedsDisplay:YES];
														if (progress >= 1.0) {
															gStretch = 1.0;
															gAngle = 0.0;
															[gPointerView setNeedsDisplay:YES];
															[timer invalidate];
															if (gScootTimer == timer) {
																gScootTimer = nil;
															}
														}
													}];
}

static void apply_highlight(double x, double y, double w, double h) {
	if (gHighlightWindow == nil || w <= 0.0 || h <= 0.0) {
		return;
	}
	CGFloat screenHeight = primary_screen_height();
	[gHighlightWindow setFrame:NSMakeRect(x, screenHeight - y - h, w, h) display:YES];
	[gHighlightWindow.contentView setNeedsDisplay:YES];
	[gHighlightWindow setAlphaValue:1.0];
	[gHighlightWindow orderFrontRegardless];
	if (gHighlightTimer != nil) {
		[gHighlightTimer invalidate];
		gHighlightTimer = nil;
	}
	NSTimeInterval start = [NSDate timeIntervalSinceReferenceDate];
	gHighlightTimer = [NSTimer scheduledTimerWithTimeInterval:1.0 / 60.0
													  repeats:YES
														block:^(NSTimer *timer) {
															double progress =
																([NSDate timeIntervalSinceReferenceDate] - start) / 0.5;
															if (progress >= 1.0) {
																[gHighlightWindow setAlphaValue:0.0];
																[gHighlightWindow orderOut:nil];
																[timer invalidate];
																if (gHighlightTimer == timer) {
																	gHighlightTimer = nil;
																}
																return;
															}
															[gHighlightWindow setAlphaValue:1.0 - progress];
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
		double w = 0.0;
		double h = 0.0;
		if (sscanf(line, "set %lf %lf", &x, &y) == 2) {
			dispatch_async(dispatch_get_main_queue(), ^{
				apply_set(x, y);
			});
		} else if (sscanf(line, "highlight %lf %lf %lf %lf", &x, &y, &w, &h) == 4) {
			dispatch_async(dispatch_get_main_queue(), ^{
				apply_highlight(x, y, w, h);
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
		[gWindow setLevel:NSFloatingWindowLevel];
		[gWindow setCollectionBehavior:NSWindowCollectionBehaviorCanJoinAllSpaces |
									   NSWindowCollectionBehaviorStationary | NSWindowCollectionBehaviorIgnoresCycle |
									   NSWindowCollectionBehaviorFullScreenAuxiliary];
		gPointerView = [[OverlayPointerView alloc] initWithFrame:frame];
		[gWindow setContentView:gPointerView];

		gHighlightWindow = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 100, 100)
													   styleMask:NSWindowStyleMaskBorderless
														 backing:NSBackingStoreBuffered
														   defer:NO];
		[gHighlightWindow setOpaque:NO];
		[gHighlightWindow setBackgroundColor:[NSColor clearColor]];
		[gHighlightWindow setHasShadow:NO];
		[gHighlightWindow setIgnoresMouseEvents:YES];
		[gHighlightWindow setLevel:NSFloatingWindowLevel];
		[gHighlightWindow setCollectionBehavior:NSWindowCollectionBehaviorCanJoinAllSpaces |
											  NSWindowCollectionBehaviorStationary | NSWindowCollectionBehaviorIgnoresCycle |
											  NSWindowCollectionBehaviorFullScreenAuxiliary];
		[gHighlightWindow setContentView:[[HighlightView alloc] initWithFrame:NSMakeRect(0, 0, 100, 100)]];

		pthread_t thread;
		pthread_create(&thread, NULL, stdin_reader, NULL);
		pthread_detach(thread);

		[NSApp run];
	}
	return 0;
}

// Agent cursor artwork is modelled on Cua Driver's built-in `cua.default`
// cursor theme (https://github.com/trycua/cua,
// libs/cua-driver/rust/crates/cursor-overlay/assets/build_default_theme.py:
// CURSOR_PATH, cursor_layers, cue_layers, action_click/observe/scroll).
// Copyright (c) 2025 Cua AI, Inc., MIT licence.
#import <Cocoa/Cocoa.h>
#import <errno.h>
#import <pthread.h>
#import <stdlib.h>
#import <string.h>
#import <sys/socket.h>
#import <sys/un.h>
#import <unistd.h>

static NSWindow *gWindow = nil;
static NSView *gPointerView = nil;
static NSWindow *gHighlightWindow = nil;
static NSTimer *gHighlightTimer = nil;
// Click feedback: an expanding ring drawn where a press lands, so a person
// watching can see every click, including accessibility presses that never move
// any pointer.
static NSWindow *gRippleWindow = nil;
static NSTimer *gRippleTimer = nil;
static double gRipple = 0.0; // 0..1 animation phase
static const CGFloat kRippleSize = 72.0;
static BOOL gShown = NO;
static NSTimer *gScootTimer = nil;
static NSPoint gScootFrom;
static NSPoint gScootTo;
static NSTimeInterval gScootStart;

// Cursor MODE: 0 = pointer (acting/clicking), 1 = scroll (chevron cue beside
// the arrow), 2 = thinking/observing (glow breathes and "looking" arcs pulse so
// it never just vanishes while the agent reasons).
static int gMode = 0;
static double gPulse =
		0.0; // 0..1 animation phase for the scroll/observe cue loop
static NSTimer *gPulseTimer = nil;

// Persistent-daemon idle shutdown: when driven over a unix socket the overlay
// outlives any single CLI command, so it self-terminates after this many
// seconds with no command (0 disables — the stdin/legacy mode never times out).
static NSTimer *gIdleTimer = nil;
static double gIdleTimeout = 0.0;

static void reset_idle_timer(void) {
	if (gIdleTimeout <= 0.0) {
		return;
	}
	if (gIdleTimer != nil) {
		[gIdleTimer invalidate];
		gIdleTimer = nil;
	}
	gIdleTimer = [NSTimer scheduledTimerWithTimeInterval:gIdleTimeout
																							 repeats:NO
																								 block:^(NSTimer *timer) {
																									 (void)timer;
																									 [NSApp terminate:nil];
																								 }];
}

// Cursor geometry. The arrow is authored on Cua's 128-unit theme canvas and
// drawn at its 42-point display size. The overlay window is a fixed box with
// the arrow tip pinned at (kHotspotX, kHotspotY) from its top-left corner, so
// every screen point the agent targets lands exactly on the tip.
static const CGFloat kOverlaySize = 56.0;
static const CGFloat kHotspotX = 18.0;
static const CGFloat kHotspotY = 18.0;
static const CGFloat kThemeCanvas = 128.0;
static const CGFloat kThemeDisplaySize = 42.0;
// Apex of the rounded tip on the theme canvas. Cua declares (55, 30) - a point
// on the top edge about 3pt right of the visible tip - so we pin the visible
// apex instead: what a person reads as "where it points".
static const CGFloat kThemeTipX = 45.5;
static const CGFloat kThemeTipY = 32.0;
static const CGFloat kThemeFps = 30.0;
static const NSTimeInterval kFadeInDuration = 0.18;
// Longer glide so the cursor visibly travels across the screen (codex-style),
// rather than snapping between points.
static const NSTimeInterval kScootDuration = 0.42;
// Cua's click cue is 20 frames and its looping observe/scroll cues are 48
// frames, both at 30fps.
static const NSTimeInterval kClickDuration = 20.0 / kThemeFps;
static const NSTimeInterval kCueLoopDuration = 48.0 / kThemeFps;

static void stop_pulse(void) {
	if (gPulseTimer != nil) {
		[gPulseTimer invalidate];
		gPulseTimer = nil;
	}
	gPulse = 0.0;
	[gPointerView setNeedsDisplay:YES];
}

static void start_pulse(void) {
	if (gPulseTimer != nil) {
		return;
	}
	gPulseTimer = [NSTimer
			scheduledTimerWithTimeInterval:1.0 / 30.0
														 repeats:YES
															 block:^(NSTimer *timer) {
																 (void)timer;
																 gPulse += (1.0 / 30.0) / kCueLoopDuration;
																 if (gPulse > 1.0) {
																	 gPulse -= 1.0;
																 }
																 [gPointerView setNeedsDisplay:YES];
															 }];
}

static void start_ripple(NSPoint windowOrigin);

static void apply_mode(const char *name) {
	// "click" is an event, not a mode: ripple at the tip where the cursor is
	// heading, once it arrives.
	if (strncmp(name, "click", 5) == 0) {
		if (gWindow == nil || !gShown) {
			return;
		}
		NSPoint destination = gScootTimer != nil ? gScootTo : gWindow.frame.origin;
		NSTimeInterval wait = gScootTimer != nil ? kScootDuration : 0.0;
		dispatch_after(
				dispatch_time(DISPATCH_TIME_NOW, (int64_t)(wait * NSEC_PER_SEC)),
				dispatch_get_main_queue(), ^{
					start_ripple(destination);
				});
		return;
	}
	int mode = 0;
	if (strncmp(name, "scroll", 6) == 0) {
		mode = 1;
	} else if (strncmp(name, "think", 5) == 0) {
		mode = 2;
	}
	gMode = mode;
	if (mode == 1 || mode == 2) {
		start_pulse();
	} else {
		stop_pulse();
	}
	// Only repaint/raise if the cursor is already positioned — a mode set before
	// the first `set` must NOT flash the cursor at (0,0); it applies once
	// positioned.
	if (gWindow != nil && gShown) {
		[gWindow orderFrontRegardless];
		[gPointerView setNeedsDisplay:YES];
	}
}

// Cua Driver palette: session fill (the anonymous/default session's Cua blue),
// white ink, and the effect colour (fill lifted 45% toward white) used for the
// press ripple.
static NSColor *cua_fill(CGFloat alpha) {
	return [NSColor colorWithSRGBRed:94.0 / 255.0
														 green:192.0 / 255.0
															blue:232.0 / 255.0
														 alpha:alpha];
}

static NSColor *cua_ink(CGFloat alpha) {
	return [NSColor colorWithSRGBRed:1.0 green:1.0 blue:1.0 alpha:alpha];
}

static NSColor *cua_effect(CGFloat alpha) {
	return [NSColor colorWithSRGBRed:167.0 / 255.0
														 green:220.0 / 255.0
															blue:242.0 / 255.0
														 alpha:alpha];
}

// Piecewise keyframe track {frame, value}, smoothstepped between keys (Cua
// eases every key).
typedef struct {
	CGFloat frame;
	CGFloat value;
} Keyframe;

static CGFloat keyframe_value(const Keyframe *keys, int count, CGFloat frame) {
	if (frame <= keys[0].frame) {
		return keys[0].value;
	}
	for (int i = 1; i < count; i++) {
		if (frame <= keys[i].frame) {
			CGFloat t =
					(frame - keys[i - 1].frame) / (keys[i].frame - keys[i - 1].frame);
			t = t * t * (3.0 - 2.0 * t);
			return keys[i - 1].value + (keys[i].value - keys[i - 1].value) * t;
		}
	}
	return keys[count - 1].value;
}

static NSBezierPath *round_path(void) {
	NSBezierPath *path = [NSBezierPath bezierPath];
	path.lineJoinStyle = NSLineJoinStyleRound;
	path.lineCapStyle = NSLineCapStyleRound;
	return path;
}

// The arrow outline: Cua's CURSOR_PATH, rows of {vertex, in-tangent,
// out-tangent} (tangents relative).
static NSBezierPath *arrow_path(void) {
	static NSBezierPath *path = nil;
	if (path != nil) {
		return path;
	}
	static const CGFloat v[8][6] = {
			{55, 30, 0, 0, -7, -2}, {43, 41, -1, -8, 0, 0}, {64, 98, 0, 0, 3, 8},
			{77, 99, -4, 7, 0, 0},	{86, 79, 0, 0, 2, -4},	{95, 70, -4, 2, 0, 0},
			{108, 63, 0, 0, 7, -4}, {107, 50, 7, 3, 0, 0},
	};
	path = round_path();
	[path moveToPoint:NSMakePoint(v[0][0], v[0][1])];
	for (int i = 0; i < 8; i++) {
		int n = (i + 1) % 8;
		[path curveToPoint:NSMakePoint(v[n][0], v[n][1])
				 controlPoint1:NSMakePoint(v[i][0] + v[i][4], v[i][1] + v[i][5])
				 controlPoint2:NSMakePoint(v[n][0] + v[n][2], v[n][1] + v[n][3])];
	}
	[path closePath];
	return path;
}

static NSBezierPath *segments_path(const CGFloat (*points)[2], const int *runs,
																	 int runCount) {
	NSBezierPath *path = round_path();
	int index = 0;
	for (int r = 0; r < runCount; r++) {
		[path moveToPoint:NSMakePoint(points[index][0], points[index][1])];
		for (int i = 1; i < runs[r]; i++) {
			[path
					lineToPoint:NSMakePoint(points[index + i][0], points[index + i][1])];
		}
		index += runs[r];
	}
	return path;
}

// action_click: three short rays fanning out from the upper-left of the tip.
static NSBezierPath *click_rays_path(void) {
	static NSBezierPath *path = nil;
	if (path == nil) {
		static const CGFloat points[6][2] = {{35, 20}, {34, 11}, {27, 25},
																				 {19, 19}, {25, 34}, {15, 34}};
		static const int runs[3] = {2, 2, 2};
		path = segments_path(points, runs, 3);
	}
	return path;
}

// action_scroll: up and down chevrons to the left of the arrow.
static NSBezierPath *scroll_chevrons_path(void) {
	static NSBezierPath *path = nil;
	if (path == nil) {
		static const CGFloat points[6][2] = {{23, 31}, {31, 22}, {39, 31},
																				 {23, 49}, {31, 58}, {39, 49}};
		static const int runs[2] = {3, 3};
		path = segments_path(points, runs, 2);
	}
	return path;
}

// action_observe: two concentric "looking" arcs above-left of the tip.
static NSBezierPath *observe_arcs_path(void) {
	static NSBezierPath *path = nil;
	if (path == nil) {
		path = round_path();
		[path moveToPoint:NSMakePoint(38, 28)];
		[path curveToPoint:NSMakePoint(20, 49)
				 controlPoint1:NSMakePoint(27, 29)
				 controlPoint2:NSMakePoint(20, 38)];
		[path moveToPoint:NSMakePoint(42, 19)];
		[path curveToPoint:NSMakePoint(11, 51)
				 controlPoint1:NSMakePoint(23, 19)
				 controlPoint2:NSMakePoint(11, 33)];
	}
	return path;
}

static void stroke_path(NSBezierPath *path, CGFloat width, NSColor *color) {
	[path setLineWidth:width];
	[color setStroke];
	[path stroke];
}

// cursor_layers: eight widening, fading Cua-blue glow strokes under a blue body
// with a white outline.
static void draw_arrow(CGFloat glowBoost) {
	static const CGFloat glow[8][2] = {{44, 2.0}, {36, 2.4}, {29, 3.0}, {23, 3.8},
																		 {18, 4.8}, {14, 6.0}, {10, 7.5}, {7, 9.5}};
	NSBezierPath *path = arrow_path();
	for (int i = 0; i < 8; i++) {
		stroke_path(path, glow[i][0],
								cua_fill(fmin(1.0, glow[i][1] / 100.0 * glowBoost)));
	}
	[cua_fill(1.0) setFill];
	[path fill];
	stroke_path(path, 5.0, cua_ink(1.0));
}

// cue_layers: a layer (anchor 64,64 placed at px,py, scaled) of glow strokes, a
// white outline, then a blue core.
static void draw_cue(CGContextRef ctx, NSBezierPath *geometry, CGFloat px,
										 CGFloat py, CGFloat scale, CGFloat alpha) {
	if (alpha <= 0.001) {
		return;
	}
	static const CGFloat glow[4][2] = {{13, 2.4}, {9, 3.1}, {6, 4.0}, {3, 5.2}};
	const CGFloat width = 4.0;
	CGContextSaveGState(ctx);
	CGContextTranslateCTM(ctx, px, py);
	CGContextScaleCTM(ctx, scale, scale);
	CGContextTranslateCTM(ctx, -64.0, -64.0);
	for (int i = 0; i < 4; i++) {
		stroke_path(geometry, width + glow[i][0],
								cua_fill(alpha * glow[i][1] / 100.0));
	}
	stroke_path(geometry, width + 1.5, cua_ink(alpha));
	stroke_path(geometry, width - 1.0, cua_fill(alpha));
	CGContextRestoreGState(ctx);
}

@interface OverlayPointerView : NSView
@end

@implementation OverlayPointerView
- (BOOL)isFlipped {
	return YES;
}
- (void)drawRect:(NSRect)dirtyRect {
	(void)dirtyRect;
	CGContextRef ctx = NSGraphicsContext.currentContext.CGContext;
	CGContextSaveGState(ctx);
	// Theme canvas -> view: the canvas tip lands on the window hotspot.
	CGFloat artScale = kThemeDisplaySize / kThemeCanvas;
	CGContextTranslateCTM(ctx, kHotspotX, kHotspotY);
	CGContextScaleCTM(ctx, artScale, artScale);
	CGContextTranslateCTM(ctx, -kThemeTipX, -kThemeTipY);

	BOOL clicking = gRippleTimer != nil;
	CGFloat clickFrame = gRipple * 20.0;
	CGFloat loopFrame = gPulse * 48.0;
	CGFloat breathe = (gMode == 2) ? (0.5 - 0.5 * cos(gPulse * 2.0 * M_PI)) : 0.0;

	// Press squish (Cua: 100% -> 93% -> 103% -> 100%), pivoting on the tip so it
	// never leaves the target.
	static const Keyframe squish[4] = {
			{0, 1.0}, {7, 0.93}, {12, 1.03}, {20, 1.0}};
	CGFloat bodyScale = clicking ? keyframe_value(squish, 4, clickFrame) : 1.0;
	CGContextSaveGState(ctx);
	CGContextTranslateCTM(ctx, kThemeTipX, kThemeTipY);
	CGContextScaleCTM(ctx, bodyScale, bodyScale);
	CGContextTranslateCTM(ctx, -kThemeTipX, -kThemeTipY);
	draw_arrow(1.0 + 1.6 * breathe);
	CGContextRestoreGState(ctx);

	if (gMode == 1) {
		static const Keyframe y[3] = {{0, 68}, {24, 60}, {48, 68}};
		static const Keyframe a[3] = {{0, 0.42}, {24, 1.0}, {48, 0.42}};
		draw_cue(ctx, scroll_chevrons_path(), 59, keyframe_value(y, 3, loopFrame),
						 1.0, keyframe_value(a, 3, loopFrame));
	} else if (gMode == 2) {
		static const Keyframe s[3] = {{0, 0.88}, {24, 1.0}, {48, 1.08}};
		static const Keyframe a[5] = {{0, 0}, {7, 1}, {34, 1}, {44, 0}, {48, 0}};
		draw_cue(ctx, observe_arcs_path(), 72, 54, keyframe_value(s, 3, loopFrame),
						 keyframe_value(a, 5, loopFrame));
	}
	if (clicking) {
		static const Keyframe s[3] = {{0, 1.1}, {8, 1.3}, {20, 1.5}};
		static const Keyframe a[4] = {{0, 0}, {4, 1}, {11, 1}, {20, 0}};
		draw_cue(ctx, click_rays_path(), 74, 67, keyframe_value(s, 3, clickFrame),
						 keyframe_value(a, 4, clickFrame));
	}
	CGContextRestoreGState(ctx);
}
@end

// Press ripple: an expanding ring in the Cua effect colour, centred on the
// arrow tip.
@interface RippleView : NSView
@end

@implementation RippleView
- (void)drawRect:(NSRect)dirtyRect {
	(void)dirtyRect;
	NSRect bounds = self.bounds;
	CGFloat progress = fmin(1.0, gRipple * 1.6);
	CGFloat eased = 1.0 - pow(1.0 - progress, 3.0);
	CGFloat radius = 4.0 + (NSWidth(bounds) / 2.0 - 6.0) * eased;
	NSRect ring = NSMakeRect(NSMidX(bounds) - radius, NSMidY(bounds) - radius,
													 radius * 2.0, radius * 2.0);
	NSBezierPath *path = [NSBezierPath bezierPathWithOvalInRect:ring];
	stroke_path(path, 2.5, cua_effect(0.95 * (1.0 - progress)));
}
@end

// Tip of the arrow, in Cocoa screen coordinates, for a pointer window at
// `windowOrigin`.
static NSPoint tip_for_origin(NSPoint windowOrigin) {
	return NSMakePoint(windowOrigin.x + kHotspotX,
										 windowOrigin.y + kOverlaySize - kHotspotY);
}

static void start_ripple(NSPoint windowOrigin) {
	if (gRippleWindow == nil) {
		return;
	}
	NSPoint tip = tip_for_origin(windowOrigin);
	[gRippleWindow setFrameOrigin:NSMakePoint(tip.x - kRippleSize / 2.0,
																						tip.y - kRippleSize / 2.0)];
	[gRippleWindow orderFrontRegardless];
	// Keep the arrow above its own ripple.
	[gWindow orderFrontRegardless];
	if (gRippleTimer != nil) {
		[gRippleTimer invalidate];
		gRippleTimer = nil;
	}
	gRipple = 0.0;
	NSTimeInterval start = [NSDate timeIntervalSinceReferenceDate];
	gRippleTimer = [NSTimer
			scheduledTimerWithTimeInterval:1.0 / 60.0
														 repeats:YES
															 block:^(NSTimer *timer) {
																 gRipple =
																		 ([NSDate timeIntervalSinceReferenceDate] -
																			start) /
																		 kClickDuration;
																 if (gRipple >= 1.0) {
																	 gRipple = 1.0;
																	 [gRippleWindow orderOut:nil];
																	 [timer invalidate];
																	 if (gRippleTimer == timer) {
																		 gRippleTimer = nil;
																	 }
																	 [gPointerView setNeedsDisplay:YES];
																	 return;
																 }
																 [gRippleWindow.contentView
																		 setNeedsDisplay:YES];
																 [gPointerView setNeedsDisplay:YES];
															 }];
}

@interface HighlightView : NSView
@end

@implementation HighlightView
- (void)drawRect:(NSRect)dirtyRect {
	(void)dirtyRect;
	NSRect inset = NSInsetRect(self.bounds, 3.0, 3.0);
	NSBezierPath *outline = [NSBezierPath bezierPathWithRoundedRect:inset
																													xRadius:12.0
																													yRadius:12.0];
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
	// Cocoa window origins are bottom-left; the tip sits kHotspotY below the
	// window's top edge.
	NSPoint target =
			NSMakePoint(x - kHotspotX, screenHeight - y + kHotspotY - kOverlaySize);
	if (!gShown) {
		gShown = YES;
		[gWindow setAlphaValue:0.0];
		[gWindow setFrameOrigin:target];
		[gWindow orderFrontRegardless];
		[NSAnimationContext
				runAnimationGroup:^(NSAnimationContext *context) {
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
	gScootTimer = [NSTimer
			scheduledTimerWithTimeInterval:1.0 / 60.0
														 repeats:YES
															 block:^(NSTimer *timer) {
																 double progress =
																		 ([NSDate timeIntervalSinceReferenceDate] -
																			gScootStart) /
																		 kScootDuration;
																 if (progress > 1.0) {
																	 progress = 1.0;
																 }
																 double eased =
																		 progress < 0.5
																				 ? 2.0 * progress * progress
																				 : 1.0 -
																							 pow(-2.0 * progress + 2.0, 2.0) /
																									 2.0;
																 [gWindow
																		 setFrameOrigin:NSMakePoint(
																												gScootFrom.x +
																														(gScootTo.x -
																														 gScootFrom.x) *
																																eased,
																												gScootFrom.y +
																														(gScootTo.y -
																														 gScootFrom.y) *
																																eased)];
																 if (progress >= 1.0) {
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
	[gHighlightWindow setFrame:NSMakeRect(x, screenHeight - y - h, w, h)
										 display:YES];
	[gHighlightWindow.contentView setNeedsDisplay:YES];
	[gHighlightWindow setAlphaValue:1.0];
	[gHighlightWindow orderFrontRegardless];
	if (gHighlightTimer != nil) {
		[gHighlightTimer invalidate];
		gHighlightTimer = nil;
	}
	NSTimeInterval start = [NSDate timeIntervalSinceReferenceDate];
	gHighlightTimer = [NSTimer
			scheduledTimerWithTimeInterval:1.0 / 60.0
														 repeats:YES
															 block:^(NSTimer *timer) {
																 double progress =
																		 ([NSDate timeIntervalSinceReferenceDate] -
																			start) /
																		 0.5;
																 if (progress >= 1.0) {
																	 [gHighlightWindow setAlphaValue:0.0];
																	 [gHighlightWindow orderOut:nil];
																	 [timer invalidate];
																	 if (gHighlightTimer == timer) {
																		 gHighlightTimer = nil;
																	 }
																	 return;
																 }
																 [gHighlightWindow
																		 setAlphaValue:1.0 - progress];
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

// Parse one command line and apply it on the main thread. Returns 1 for "quit".
// Every recognized command resets the idle timer (daemon mode only).
static int dispatch_command_line(const char *line) {
	double x = 0.0;
	double y = 0.0;
	double w = 0.0;
	double h = 0.0;
	// sscanf accepts "nan" and "inf"; a non-finite frame makes Core Animation
	// throw and would end the overlay, so such lines are dropped like any other
	// malformed command.
	if (sscanf(line, "set %lf %lf", &x, &y) == 2) {
		if (!isfinite(x) || !isfinite(y)) {
			return 0;
		}
		dispatch_async(dispatch_get_main_queue(), ^{
			apply_set(x, y);
			reset_idle_timer();
		});
	} else if (sscanf(line, "highlight %lf %lf %lf %lf", &x, &y, &w, &h) == 4) {
		if (!isfinite(x) || !isfinite(y) || !isfinite(w) || !isfinite(h)) {
			return 0;
		}
		dispatch_async(dispatch_get_main_queue(), ^{
			apply_highlight(x, y, w, h);
			reset_idle_timer();
		});
	} else if (strncmp(line, "hide", 4) == 0) {
		dispatch_async(dispatch_get_main_queue(), ^{
			apply_hide();
			reset_idle_timer();
		});
	} else if (strncmp(line, "mode ", 5) == 0) {
		char name[32] = {0};
		if (sscanf(line, "mode %31s", name) == 1) {
			char *copy = strdup(name);
			dispatch_async(dispatch_get_main_queue(), ^{
				apply_mode(copy);
				free(copy);
				reset_idle_timer();
			});
		}
	} else if (strncmp(line, "quit", 4) == 0) {
		return 1;
	}
	return 0;
}

// Legacy mode: one command channel over stdin, dies when stdin closes.
static void *stdin_reader(void *arg) {
	(void)arg;
	char line[256];
	while (fgets(line, sizeof(line), stdin) != NULL) {
		if (dispatch_command_line(line)) {
			break;
		}
	}
	dispatch_async(dispatch_get_main_queue(), ^{
		[NSApp terminate:nil];
	});
	return NULL;
}

// Feed accumulated bytes through the line splitter, applying each command.
// Returns 1 if a "quit" was seen. *llp is the running line-buffer length.
static int drain_bytes(const char *buf, ssize_t n, char *line, size_t cap,
											 size_t *llp) {
	for (ssize_t i = 0; i < n; i++) {
		char c = buf[i];
		if (c == '\n' || *llp == cap - 1) {
			line[*llp] = '\0';
			int quit = (*llp > 0) ? dispatch_command_line(line) : 0;
			*llp = 0;
			if (quit) {
				return 1;
			}
		} else {
			line[(*llp)++] = c;
		}
	}
	return 0;
}

// Persistent daemon mode: a unix-domain socket server so the overlay outlives
// any single CLI command (each apple-cua verb is its own process). Singleton:
// if a daemon already owns the socket, exit. Self-terminates after idle
// timeout.
static void *socket_reader(void *arg) {
	char *path = (char *)arg;
	struct sockaddr_un addr;
	memset(&addr, 0, sizeof(addr));
	addr.sun_family = AF_UNIX;
	strncpy(addr.sun_path, path, sizeof(addr.sun_path) - 1);

	// If another daemon already listens here, stand down (singleton).
	int probe = socket(AF_UNIX, SOCK_STREAM, 0);
	if (probe >= 0) {
		if (connect(probe, (struct sockaddr *)&addr, sizeof(addr)) == 0) {
			close(probe);
			free(path);
			dispatch_async(dispatch_get_main_queue(), ^{
				[NSApp terminate:nil];
			});
			return NULL;
		}
		close(probe);
	}
	unlink(path); // clear any stale socket file from a crashed daemon

	int server = socket(AF_UNIX, SOCK_STREAM, 0);
	if (server < 0 || bind(server, (struct sockaddr *)&addr, sizeof(addr)) != 0 ||
			listen(server, 8) != 0) {
		if (server >= 0) {
			close(server);
		}
		free(path);
		dispatch_async(dispatch_get_main_queue(), ^{
			[NSApp terminate:nil];
		});
		return NULL;
	}
	dispatch_async(dispatch_get_main_queue(), ^{
		reset_idle_timer();
	});

	int stop = 0;
	while (!stop) {
		int client = accept(server, NULL, NULL);
		if (client < 0) {
			if (errno == EINTR) {
				continue;
			}
			break;
		}
		char buf[512];
		char line[256];
		size_t ll = 0;
		ssize_t n;
		while ((n = read(client, buf, sizeof(buf))) > 0) {
			if (drain_bytes(buf, n, line, sizeof(line), &ll)) {
				stop = 1;
				break;
			}
		}
		close(client);
	}
	close(server);
	unlink(path);
	free(path);
	dispatch_async(dispatch_get_main_queue(), ^{
		[NSApp terminate:nil];
	});
	return NULL;
}

int main(int argc, const char *argv[]) {
	const char *socketPath = NULL;
	for (int i = 1; i < argc; i++) {
		if (strcmp(argv[i], "--socket") == 0 && i + 1 < argc) {
			socketPath = argv[++i];
		} else if (strcmp(argv[i], "--idle") == 0 && i + 1 < argc) {
			gIdleTimeout = atof(argv[++i]);
		}
	}
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
		[gWindow
				setCollectionBehavior:NSWindowCollectionBehaviorCanJoinAllSpaces |
															NSWindowCollectionBehaviorStationary |
															NSWindowCollectionBehaviorIgnoresCycle |
															NSWindowCollectionBehaviorFullScreenAuxiliary];
		gPointerView = [[OverlayPointerView alloc] initWithFrame:frame];
		[gWindow setContentView:gPointerView];

		gHighlightWindow =
				[[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 100, 100)
																		styleMask:NSWindowStyleMaskBorderless
																			backing:NSBackingStoreBuffered
																				defer:NO];
		[gHighlightWindow setOpaque:NO];
		[gHighlightWindow setBackgroundColor:[NSColor clearColor]];
		[gHighlightWindow setHasShadow:NO];
		[gHighlightWindow setIgnoresMouseEvents:YES];
		[gHighlightWindow setLevel:NSFloatingWindowLevel];
		[gHighlightWindow
				setCollectionBehavior:NSWindowCollectionBehaviorCanJoinAllSpaces |
															NSWindowCollectionBehaviorStationary |
															NSWindowCollectionBehaviorIgnoresCycle |
															NSWindowCollectionBehaviorFullScreenAuxiliary];
		[gHighlightWindow
				setContentView:[[HighlightView alloc]
													 initWithFrame:NSMakeRect(0, 0, 100, 100)]];

		NSRect rippleFrame = NSMakeRect(0, 0, kRippleSize, kRippleSize);
		gRippleWindow =
				[[NSWindow alloc] initWithContentRect:rippleFrame
																		styleMask:NSWindowStyleMaskBorderless
																			backing:NSBackingStoreBuffered
																				defer:NO];
		[gRippleWindow setOpaque:NO];
		[gRippleWindow setBackgroundColor:[NSColor clearColor]];
		[gRippleWindow setHasShadow:NO];
		[gRippleWindow setIgnoresMouseEvents:YES];
		[gRippleWindow setLevel:NSFloatingWindowLevel];
		[gRippleWindow
				setCollectionBehavior:NSWindowCollectionBehaviorCanJoinAllSpaces |
															NSWindowCollectionBehaviorStationary |
															NSWindowCollectionBehaviorIgnoresCycle |
															NSWindowCollectionBehaviorFullScreenAuxiliary];
		[gRippleWindow
				setContentView:[[RippleView alloc] initWithFrame:rippleFrame]];

		pthread_t thread;
		if (socketPath != NULL) {
			if (gIdleTimeout <= 0.0) {
				gIdleTimeout = 4.0; // default: vanish 4s after the last command
			}
			pthread_create(&thread, NULL, socket_reader, strdup(socketPath));
		} else {
			pthread_create(&thread, NULL, stdin_reader, NULL);
		}
		pthread_detach(thread);

		[NSApp run];
	}
	return 0;
}
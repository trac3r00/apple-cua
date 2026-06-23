#import <Cocoa/Cocoa.h>
#import <pthread.h>
#import <sys/socket.h>
#import <sys/un.h>
#import <unistd.h>
#import <errno.h>
#import <stdlib.h>
#import <string.h>

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

// Cursor MODE: 0 = pointer (acting/clicking), 1 = scroll (scroll glyph),
// 2 = thinking (pulses in place so it never just vanishes while the agent reasons).
static int gMode = 0;
static double gPulse = 0.0;      // 0..1 animation phase for thinking
static NSTimer *gPulseTimer = nil;

// Persistent-daemon idle shutdown: when driven over a unix socket the overlay
// outlives any single CLI command, so it self-terminates after this many seconds
// with no command (0 disables — the stdin/legacy mode never times out).
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

static const CGFloat kOverlaySize = 40.0;
static const NSTimeInterval kFadeInDuration = 0.18;
// Longer glide so the cursor visibly travels across the screen (codex-style),
// rather than snapping between points.
static const NSTimeInterval kScootDuration = 0.42;
static const CGFloat kRingRadius = 9.0;
static const CGFloat kCoreRadius = 6.0;
static const CGFloat kMaxStretch = 0.38;

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
	gPulseTimer = [NSTimer scheduledTimerWithTimeInterval:1.0 / 30.0
												  repeats:YES
													block:^(NSTimer *timer) {
														(void)timer;
														gPulse += (1.0 / 30.0) / 1.3;  // ~1.3s breath
														if (gPulse > 1.0) {
															gPulse -= 1.0;
														}
														[gPointerView setNeedsDisplay:YES];
													}];
}

static void apply_mode(const char *name) {
	int mode = 0;
	if (strncmp(name, "scroll", 6) == 0) {
		mode = 1;
	} else if (strncmp(name, "think", 5) == 0) {
		mode = 2;
	}
	gMode = mode;
	if (mode == 2) {
		start_pulse();
	} else {
		stop_pulse();
	}
	// Only repaint/raise if the cursor is already positioned — a mode set before the
	// first `set` must NOT flash the cursor at (0,0); it applies once positioned.
	if (gWindow != nil && gShown) {
		[gWindow orderFrontRegardless];
		[gPointerView setNeedsDisplay:YES];
	}
}

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
	// Thinking mode "breathes": ring grows/shrinks with the pulse phase.
	CGFloat breathe = (gMode == 2) ? (0.5 + 0.5 * sin(gPulse * 2.0 * M_PI)) : 0.0;
	CGFloat ringR = kRingRadius + 2.0 * breathe;

	// Dark outline first so the white ring + blue core stay visible on ANY
	// background (light pages would otherwise swallow the white halo).
	CGFloat kOutline = ringR + 1.6;
	NSBezierPath *outline = [NSBezierPath
		bezierPathWithOvalInRect:NSMakeRect(cx - kOutline, cy - kOutline, kOutline * 2, kOutline * 2)];
	[[NSColor colorWithSRGBRed:0.0 green:0.0 blue:0.0 alpha:0.55] setFill];
	[outline fill];
	NSBezierPath *ring = [NSBezierPath
		bezierPathWithOvalInRect:NSMakeRect(cx - ringR, cy - ringR, ringR * 2, ringR * 2)];
	[[NSColor colorWithSRGBRed:1.0 green:1.0 blue:1.0 alpha:1.0] setFill];
	[ring fill];

	NSColor *blue = [NSColor colorWithSRGBRed:0.0 green:0.478 blue:1.0 alpha:1.0];
	if (gMode == 1) {
		// Scroll: a blue up/down double-chevron (⇅) instead of a solid core.
		[blue setFill];
		CGFloat w = 4.5, h = 3.0, gap = 1.6;
		NSBezierPath *up = [NSBezierPath bezierPath];
		[up moveToPoint:NSMakePoint(cx - w, cy - gap)];
		[up lineToPoint:NSMakePoint(cx + w, cy - gap)];
		[up lineToPoint:NSMakePoint(cx, cy - gap - h)];
		[up closePath];
		[up fill];
		NSBezierPath *down = [NSBezierPath bezierPath];
		[down moveToPoint:NSMakePoint(cx - w, cy + gap)];
		[down lineToPoint:NSMakePoint(cx + w, cy + gap)];
		[down lineToPoint:NSMakePoint(cx, cy + gap + h)];
		[down closePath];
		[down fill];
	} else if (gMode == 2) {
		// Thinking: a pulsing blue core (size + alpha) — "still figuring it out".
		CGFloat coreR = kCoreRadius * (0.55 + 0.45 * breathe);
		[[blue colorWithAlphaComponent:0.55 + 0.45 * breathe] setFill];
		[[NSBezierPath bezierPathWithOvalInRect:NSMakeRect(cx - coreR, cy - coreR, coreR * 2, coreR * 2)] fill];
	} else {
		// Pointer: solid blue core — the codex-style "agent is acting here" dot.
		[blue setFill];
		[[NSBezierPath bezierPathWithOvalInRect:NSMakeRect(cx - kCoreRadius, cy - kCoreRadius, kCoreRadius * 2, kCoreRadius * 2)] fill];
	}
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

// Parse one command line and apply it on the main thread. Returns 1 for "quit".
// Every recognized command resets the idle timer (daemon mode only).
static int dispatch_command_line(const char *line) {
	double x = 0.0;
	double y = 0.0;
	double w = 0.0;
	double h = 0.0;
	if (sscanf(line, "set %lf %lf", &x, &y) == 2) {
		dispatch_async(dispatch_get_main_queue(), ^{
			apply_set(x, y);
			reset_idle_timer();
		});
	} else if (sscanf(line, "highlight %lf %lf %lf %lf", &x, &y, &w, &h) == 4) {
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
static int drain_bytes(const char *buf, ssize_t n, char *line, size_t cap, size_t *llp) {
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
// any single CLI command (each macos-cua verb is its own process). Singleton:
// if a daemon already owns the socket, exit. Self-terminates after idle timeout.
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
	unlink(path);  // clear any stale socket file from a crashed daemon

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
		if (socketPath != NULL) {
			if (gIdleTimeout <= 0.0) {
				gIdleTimeout = 4.0;  // default: vanish 4s after the last command
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

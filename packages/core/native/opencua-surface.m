// opencua-surface: an agent-owned window that shows one web page on the
// person's desktop.
//
// opencua launches it, records its pid and start time, and then lets its agents
// deliver pointer events to this process only (never to the person's own apps,
// mouse or keyboard focus). The window is shown without activating the app, so
// the person's frontmost app keeps focus. Each delivered mouse event carries
// its agent's cursor id in the event source user data; the window draws that
// agent's arrow and name where the event actually landed, so the cursors on
// screen are the real input, not an animation.
//
// usage: opencua-surface <url> <title> <x,y,width,height in top-left screen
// points> [cursor-names.json]

#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <objc/message.h>

static NSString *gNamesPath = nil;

@interface SurfaceWebView : WKWebView
@end

@implementation SurfaceWebView
// The window is never key, so without this the first click of every agent
// stroke would only focus the view.
- (BOOL)acceptsFirstMouse:(NSEvent *)event {
  return YES;
}
@end

@interface CursorMark : NSObject
@property(nonatomic) NSPoint point;
@property(nonatomic) NSTimeInterval seen;
@property(nonatomic) BOOL down;
@end

@implementation CursorMark
@end

@interface CursorLayerView : NSView
@property(nonatomic, strong)
    NSMutableDictionary<NSNumber *, CursorMark *> *marks;
@property(nonatomic, strong) NSDictionary *names;
@end

@implementation CursorLayerView
- (BOOL)isFlipped {
  return NO;
}

- (NSView *)hitTest:(NSPoint)point {
  return nil;
}

static NSColor *ColorFromHex(NSString *hex) {
  unsigned int value = 0xffffff;
  if (hex.length == 7) {
    [[NSScanner scannerWithString:[hex substringFromIndex:1]]
        scanHexInt:&value];
  }
  return [NSColor colorWithRed:((value >> 16) & 255) / 255.0
                         green:((value >> 8) & 255) / 255.0
                          blue:(value & 255) / 255.0
                         alpha:1];
}

- (void)drawRect:(NSRect)dirty {
  for (NSNumber *key in self.marks) {
    CursorMark *mark = self.marks[key];
    NSDictionary *entry = self.names[key.stringValue];
    NSString *name = [entry[@"name"] isKindOfClass:NSString.class]
                         ? entry[@"name"]
                         : [NSString stringWithFormat:@"cursor %@", key];
    NSColor *color = ColorFromHex([entry[@"color"] isKindOfClass:NSString.class]
                                      ? entry[@"color"]
                                      : @"#ffffff");
    NSPoint p = mark.point;
    NSBezierPath *arrow = [NSBezierPath bezierPath];
    [arrow moveToPoint:p];
    [arrow lineToPoint:NSMakePoint(p.x, p.y - 16)];
    [arrow lineToPoint:NSMakePoint(p.x + 4.5, p.y - 12)];
    [arrow lineToPoint:NSMakePoint(p.x + 11, p.y - 12)];
    [arrow closePath];
    [color setFill];
    [arrow fill];
    [NSColor.blackColor setStroke];
    arrow.lineWidth = mark.down ? 2 : 1;
    [arrow stroke];
    NSDictionary *attributes = @{
      NSFontAttributeName : [NSFont systemFontOfSize:9 weight:NSFontWeightBold],
      NSForegroundColorAttributeName : NSColor.blackColor
    };
    NSSize size = [name sizeWithAttributes:attributes];
    NSRect box = NSMakeRect(p.x + 10, p.y - 13 - size.height, size.width + 6,
                            size.height + 1);
    [[color colorWithAlphaComponent:0.9] setFill];
    [[NSBezierPath bezierPathWithRoundedRect:box xRadius:3 yRadius:3] fill];
    [name drawAtPoint:NSMakePoint(box.origin.x + 3, box.origin.y)
        withAttributes:attributes];
  }
}
@end

@interface SurfaceWindow : NSWindow
@property(nonatomic, weak) CursorLayerView *cursorLayer;
@end

@implementation SurfaceWindow
// Agent events carry a nonzero source user data tag and draw that agent's
// cursor. The window sits one level below normal windows, so agent input can
// never bring it over the person's work; the person's own click raises it.
- (void)sendEvent:(NSEvent *)event {
  NSEventType type = event.type;
  BOOL pointer =
      type == NSEventTypeLeftMouseDown || type == NSEventTypeLeftMouseDragged ||
      type == NSEventTypeLeftMouseUp || type == NSEventTypeMouseMoved;
  CGEventRef cg = pointer ? event.CGEvent : NULL;
  int64_t owner =
      cg == NULL ? 0 : CGEventGetIntegerValueField(cg, kCGEventSourceUserData);
  if (owner == 0) {
    // The person clicked it: from now on it is an ordinary window they chose to
    // look at.
    if (type == NSEventTypeLeftMouseDown && self.level < NSNormalWindowLevel) {
      self.level = NSNormalWindowLevel;
    }
    [super sendEvent:event];
    return;
  }
  if (self.cursorLayer != nil) {
    NSNumber *key = @(owner);
    CursorMark *mark = self.cursorLayer.marks[key] ?: [CursorMark new];
    mark.point = [self.cursorLayer convertPoint:event.locationInWindow
                                       fromView:nil];
    mark.seen = NSDate.timeIntervalSinceReferenceDate;
    mark.down =
        type == NSEventTypeLeftMouseDown || type == NSEventTypeLeftMouseDragged;
    self.cursorLayer.marks[key] = mark;
    self.cursorLayer.needsDisplay = YES;
  }
  [super sendEvent:event];
}

- (BOOL)canBecomeKeyWindow {
  return NO;
}
@end

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc < 4) {
      fprintf(stderr, "usage: opencua-surface <url> <title> <x,y,width,height> "
                      "[cursor-names.json]\n");
      return 2;
    }
    NSURL *url = [NSURL URLWithString:@(argv[1])];
    NSArray<NSString *> *frameParts =
        [@(argv[3]) componentsSeparatedByString:@","];
    if (url == nil || frameParts.count != 4) {
      fprintf(stderr, "opencua-surface: invalid url or frame\n");
      return 2;
    }
    if (argc > 4) {
      gNamesPath = @(argv[4]);
    }
    NSApplication *app = NSApplication.sharedApplication;
    app.activationPolicy = NSApplicationActivationPolicyAccessory;
    CGFloat screenTop = NSMaxY(NSScreen.screens.firstObject.frame);
    NSRect content = NSMakeRect(
        frameParts[0].doubleValue,
        screenTop - frameParts[1].doubleValue - frameParts[3].doubleValue,
        frameParts[2].doubleValue, frameParts[3].doubleValue);
    SurfaceWindow *window = [[SurfaceWindow alloc]
        initWithContentRect:content
                  styleMask:NSWindowStyleMaskTitled |
                            NSWindowStyleMaskMiniaturizable
                    backing:NSBackingStoreBuffered
                      defer:NO];
    window.title = @(argv[2]);
    window.releasedWhenClosed = NO;
    NSView *root =
        [[NSView alloc] initWithFrame:((NSView *)window.contentView).bounds];
    root.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    window.contentView = root;
    SurfaceWebView *web =
        [[SurfaceWebView alloc] initWithFrame:root.bounds
                                configuration:[WKWebViewConfiguration new]];
    web.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    // WebKit stops painting a window it believes is covered; the surface sits
    // behind the person's windows on purpose, so keep it rendering or agents
    // would capture a blank page.
    SEL occlusion =
        NSSelectorFromString(@"_setWindowOcclusionDetectionEnabled:");
    if ([web respondsToSelector:occlusion]) {
      ((void (*)(id, SEL, BOOL))objc_msgSend)(web, occlusion, NO);
    }
    [root addSubview:web];
    CursorLayerView *layer =
        [[CursorLayerView alloc] initWithFrame:root.bounds];
    layer.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    layer.marks = [NSMutableDictionary dictionary];
    layer.names = @{};
    [root addSubview:layer];
    window.cursorLayer = layer;
    [web loadRequest:[NSURLRequest requestWithURL:url]];
    // Shown behind every other window and never activated, so it never covers
    // what the person is doing; they bring it forward themselves to watch.
    window.level = NSNormalWindowLevel - 1;
    // Follow the person across Spaces (including full-screen ones) without ever
    // switching Spaces for them; otherwise a Space change takes the surface off
    // screen and every agent working in it loses its window mid-task.
    window.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
                                NSWindowCollectionBehaviorStationary |
                                NSWindowCollectionBehaviorIgnoresCycle |
                                NSWindowCollectionBehaviorFullScreenAuxiliary;
    [window orderBack:nil];
    [NSTimer
        scheduledTimerWithTimeInterval:1.0
                               repeats:YES
                                 block:^(NSTimer *timer) {
                                   if (gNamesPath == nil) {
                                     return;
                                   }
                                   NSData *data = [NSData
                                       dataWithContentsOfFile:gNamesPath];
                                   id parsed =
                                       data == nil
                                           ? nil
                                           : [NSJSONSerialization
                                                 JSONObjectWithData:data
                                                            options:0
                                                              error:NULL];
                                   if ([parsed
                                           isKindOfClass:NSDictionary.class]) {
                                     layer.names = parsed;
                                     layer.needsDisplay = YES;
                                   }
                                 }];
    [app run];
  }
  return 0;
}

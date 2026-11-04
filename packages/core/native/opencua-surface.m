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
// Many agents can share one surface, each with its own cursor. The page sees a
// single mouse, so the window merges their input into one valid stream: when a
// different cursor needs the button it ends the current press where it was,
// re-applies that cursor's own tool and color picks (its context clicks) when
// another cursor changed them, and presses again where that cursor was, so
// every cursor's stroke continues without waiting for the others to finish.
//
// usage: opencua-surface <url> <title> <x,y,width,height in top-left screen
// points> [cursor-names.json]
//        opencua-surface --self-test

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

typedef NS_ENUM(NSInteger, MuxKind) {
  MuxDown,
  MuxDrag,
  MuxUp,
  MuxMove,
};

static const NSUInteger kMaxContextClicks = 4;
// How long a cursor keeps the page's one mouse before a waiting cursor gets it.
static const NSTimeInterval kSlice = 0.12;
// A holder with no input for this long gives the mouse up to a waiting cursor.
static const NSTimeInterval kIdle = 0.04;
// Pages read two presses on the same spot within this time as a double click,
// so a cursor's pick is re-applied only once this has passed since it was hit.
static const NSTimeInterval kDoubleClick = 0.45;

@interface MuxEvent : NSObject
@property(nonatomic) MuxKind kind;
@property(nonatomic) NSPoint point;
@property(nonatomic) BOOL context;
@end

@implementation MuxEvent
@end

@interface MuxCursor : NSObject
@property(nonatomic) NSPoint last;
@property(nonatomic) BOOL hasLast;
@property(nonatomic) NSTimeInterval seen;
@property(nonatomic, strong) NSMutableArray<NSValue *> *context;
@property(nonatomic, strong) NSMutableArray<MuxEvent *> *pending;
@end

@implementation MuxCursor
@end

// Merges the pointer streams of many cursors into the one stream a page can
// take. A cursor holds the stream for a short slice while the others' input
// waits in order; then the next waiting cursor takes over: the current press
// ends where it was, that cursor's own picks are re-applied if another cursor
// changed them, and its press resumes where it was. Pure state with explicit
// times, so --self-test can check it without a window.
@interface CursorMux : NSObject
@property(nonatomic, copy) void (^emit)(MuxKind kind, NSPoint point);
- (void)cursor:(int64_t)tag
          kind:(MuxKind)kind
            at:(NSPoint)point
       context:(BOOL)context
           now:(NSTimeInterval)now;
- (void)pump:(NSTimeInterval)now;
@end

@implementation CursorMux {
  NSMutableDictionary<NSNumber *, MuxCursor *> *_cursors;
  NSMutableArray<NSNumber *> *_order;
  NSMutableDictionary<NSString *, NSNumber *> *_lastHit;
  int64_t _holder;
  BOOL _down;
  int64_t _contextOwner;
  NSTimeInterval _sliceStart;
}

- (instancetype)init {
  self = [super init];
  if (self != nil) {
    _cursors = [NSMutableDictionary dictionary];
    _order = [NSMutableArray array];
    _lastHit = [NSMutableDictionary dictionary];
  }
  return self;
}

- (MuxCursor *)cursorFor:(int64_t)tag {
  MuxCursor *cursor = _cursors[@(tag)];
  if (cursor == nil) {
    cursor = [MuxCursor new];
    cursor.context = [NSMutableArray array];
    cursor.pending = [NSMutableArray array];
    _cursors[@(tag)] = cursor;
    [_order addObject:@(tag)];
  }
  return cursor;
}

static NSString *SpotKey(NSPoint point) {
  return [NSString stringWithFormat:@"%.0f,%.0f", point.x, point.y];
}

- (void)press:(MuxKind)kind at:(NSPoint)point now:(NSTimeInterval)now {
  if (kind == MuxDown) {
    _lastHit[SpotKey(point)] = @(now);
  }
  self.emit(kind, point);
}

- (void)remember:(NSPoint)point in:(MuxCursor *)cursor {
  NSIndexSet *same = [cursor.context
      indexesOfObjectsPassingTest:^BOOL(NSValue *value, NSUInteger index,
                                        BOOL *stop) {
        NSPoint old = value.pointValue;
        return fabs(old.x - point.x) < 3 && fabs(old.y - point.y) < 3;
      }];
  [cursor.context removeObjectsAtIndexes:same];
  [cursor.context addObject:[NSValue valueWithPoint:point]];
  while (cursor.context.count > kMaxContextClicks) {
    [cursor.context removeObjectAtIndex:0];
  }
}

- (void)cursor:(int64_t)tag
          kind:(MuxKind)kind
            at:(NSPoint)point
       context:(BOOL)context
           now:(NSTimeInterval)now {
  MuxCursor *cursor = [self cursorFor:tag];
  // Hover of a cursor that does not hold the mouse would only move the page's
  // one pointer away from the holder's stroke.
  if (kind == MuxMove && _holder != 0 && _holder != tag) {
    return;
  }
  MuxEvent *event = [MuxEvent new];
  event.kind = kind;
  event.point = point;
  event.context = context;
  [cursor.pending addObject:event];
  cursor.seen = now;
  [self pump:now];
}

// Whether taking the mouse now would re-apply a pick the page would read as a
// double click.
- (BOOL)canReplay:(MuxCursor *)cursor now:(NSTimeInterval)now {
  if (cursor.context.count == 0) {
    return YES;
  }
  for (NSValue *value in cursor.context) {
    NSNumber *hit = _lastHit[SpotKey(value.pointValue)];
    if (hit != nil && now - hit.doubleValue < kDoubleClick) {
      return NO;
    }
  }
  return YES;
}

- (BOOL)takeOver:(int64_t)tag now:(NSTimeInterval)now {
  MuxCursor *cursor = [self cursorFor:tag];
  BOOL replay = cursor.context.count > 0 && _contextOwner != tag;
  if (replay && ![self canReplay:cursor now:now]) {
    return NO;
  }
  if (_down) {
    self.emit(MuxUp, [self cursorFor:_holder].last);
    _down = NO;
  }
  if (replay) {
    for (NSValue *value in cursor.context) {
      [self press:MuxDown at:value.pointValue now:now];
      self.emit(MuxUp, value.pointValue);
    }
    _contextOwner = tag;
  }
  _holder = tag;
  _sliceStart = now;
  return YES;
}

- (void)deliver:(MuxEvent *)event for:(int64_t)tag now:(NSTimeInterval)now {
  MuxCursor *cursor = [self cursorFor:tag];
  if (event.kind == MuxDown || event.kind == MuxDrag) {
    if (!_down && event.kind == MuxDrag) {
      [self press:MuxDown at:(cursor.hasLast ? cursor.last : event.point) now:now];
    }
    _down = YES;
    if (event.kind == MuxDown) {
      [self press:MuxDown at:event.point now:now];
    } else {
      self.emit(MuxDrag, event.point);
    }
    if (event.kind == MuxDown && event.context) {
      [self remember:event.point in:cursor];
      _contextOwner = tag;
    }
  } else if (event.kind == MuxUp) {
    if (_down) {
      self.emit(MuxUp, event.point);
      _down = NO;
    }
  } else {
    self.emit(MuxMove, event.point);
  }
  cursor.last = event.point;
  cursor.hasLast = YES;
}

- (BOOL)othersWaitingBesides:(int64_t)tag {
  for (NSNumber *key in _order) {
    if (key.longLongValue != tag && _cursors[key].pending.count > 0) {
      return YES;
    }
  }
  return NO;
}

- (void)pump:(NSTimeInterval)now {
  for (;;) {
    MuxCursor *holder = _holder == 0 ? nil : _cursors[@(_holder)];
    BOOL others = [self othersWaitingBesides:_holder];
    BOOL keep = holder != nil &&
                (!others || (now - _sliceStart < kSlice &&
                             (holder.pending.count > 0 ||
                              (_down && now - holder.seen < kIdle))));
    if (keep) {
      if (holder.pending.count == 0) {
        return;
      }
      MuxEvent *event = holder.pending.firstObject;
      [holder.pending removeObjectAtIndex:0];
      [self deliver:event for:_holder now:now];
      continue;
    }
    // Round robin from the cursor after the holder.
    NSUInteger start = 0;
    if (_holder != 0) {
      NSUInteger index = [_order indexOfObject:@(_holder)];
      start = index == NSNotFound ? 0 : index + 1;
    }
    BOOL switched = NO;
    for (NSUInteger step = 0; step < _order.count; step += 1) {
      NSNumber *key = _order[(start + step) % _order.count];
      if (key.longLongValue == _holder || _cursors[key].pending.count == 0) {
        continue;
      }
      if ([self takeOver:key.longLongValue now:now]) {
        switched = YES;
        break;
      }
    }
    if (!switched) {
      if (holder != nil && holder.pending.count > 0) {
        MuxEvent *event = holder.pending.firstObject;
        [holder.pending removeObjectAtIndex:0];
        [self deliver:event for:_holder now:now];
        continue;
      }
      return;
    }
  }
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
@property(nonatomic, strong) CursorMux *mux;
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
  int64_t data =
      cg == NULL ? 0 : CGEventGetIntegerValueField(cg, kCGEventSourceUserData);
  // Low 32 bits: the agent's cursor tag. Bit 32: a context click (tool, size
  // or color pick) to re-apply for that cursor after another cursor cut in.
  int64_t owner = data & 0xffffffff;
  BOOL context = ((data >> 32) & 1) == 1;
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
  if (self.mux == nil) {
    self.mux = [CursorMux new];
    __weak SurfaceWindow *weakSelf = self;
    self.mux.emit = ^(MuxKind kind, NSPoint point) {
      [weakSelf deliver:kind at:point];
    };
    // Waiting cursors get the mouse when the holder's slice ends, even if no
    // new input arrives to trigger it.
    [NSTimer scheduledTimerWithTimeInterval:0.008
                                    repeats:YES
                                      block:^(NSTimer *timer) {
                                        [weakSelf.mux
                                            pump:NSProcessInfo.processInfo
                                                     .systemUptime];
                                      }];
  }
  MuxKind kind = type == NSEventTypeLeftMouseDown      ? MuxDown
                 : type == NSEventTypeLeftMouseDragged ? MuxDrag
                 : type == NSEventTypeLeftMouseUp      ? MuxUp
                                                       : MuxMove;
  [self.mux cursor:owner
              kind:kind
                at:event.locationInWindow
           context:context
               now:NSProcessInfo.processInfo.systemUptime];
}

- (void)deliver:(MuxKind)kind at:(NSPoint)point {
  NSEventType type = kind == MuxDown   ? NSEventTypeLeftMouseDown
                     : kind == MuxDrag ? NSEventTypeLeftMouseDragged
                     : kind == MuxUp   ? NSEventTypeLeftMouseUp
                                       : NSEventTypeMouseMoved;
  NSEvent *merged =
      [NSEvent mouseEventWithType:type
                         location:point
                    modifierFlags:0
                        timestamp:NSProcessInfo.processInfo.systemUptime
                     windowNumber:self.windowNumber
                          context:nil
                      eventNumber:0
                       clickCount:1
                         pressure:(kind == MuxDown || kind == MuxDrag) ? 1 : 0];
  [super sendEvent:merged];
}

- (BOOL)canBecomeKeyWindow {
  return NO;
}
@end

// Replays scripted cursor input through CursorMux at explicit times and
// compares the merged stream with what the page must receive.
static int SelfTest(void) {
  NSMutableArray<NSString *> *out = [NSMutableArray array];
  __block CursorMux *mux = [CursorMux new];
  mux.emit = ^(MuxKind kind, NSPoint point) {
    NSString *name = @[ @"D", @"G", @"U", @"M" ][kind];
    [out addObject:[NSString stringWithFormat:@"%@%.0f,%.0f", name, point.x,
                                              point.y]];
  };
  __block int failures = 0;
  void (^check)(NSString *, NSString *) = ^(NSString *label, NSString *want) {
    NSString *got = [out componentsJoinedByString:@" "];
    if (![got isEqualToString:want]) {
      failures += 1;
      fprintf(stderr, "FAIL %s\n  want: %s\n  got:  %s\n", label.UTF8String,
              want.UTF8String, got.UTF8String);
    }
    [out removeAllObjects];
  };
  void (^at)(int64_t, MuxKind, CGFloat, CGFloat, BOOL, NSTimeInterval) =
      ^(int64_t tag, MuxKind kind, CGFloat x, CGFloat y, BOOL context,
        NSTimeInterval now) {
        [mux cursor:tag kind:kind at:NSMakePoint(x, y) context:context now:now];
      };

  // A second cursor waits while the first one's stroke goes on, then draws.
  at(1, MuxDown, 0, 0, NO, 0.000);
  at(2, MuxDown, 100, 100, NO, 0.001);
  at(1, MuxDrag, 10, 0, NO, 0.010);
  at(2, MuxDrag, 110, 100, NO, 0.011);
  at(1, MuxUp, 10, 0, NO, 0.020);
  at(2, MuxUp, 110, 100, NO, 0.021);
  check(@"queued strokes", @"D0,0 G10,0 U10,0 D100,100 G110,100 U110,100");

  // When the holder's slice ends, the waiting cursor takes over, and the
  // first stroke resumes where it was.
  mux = [CursorMux new];
  mux.emit = ^(MuxKind kind, NSPoint point) {
    NSString *name = @[ @"D", @"G", @"U", @"M" ][kind];
    [out addObject:[NSString stringWithFormat:@"%@%.0f,%.0f", name, point.x,
                                              point.y]];
  };
  at(1, MuxDown, 0, 0, NO, 0.00);
  at(1, MuxDrag, 1, 0, NO, 0.05);
  at(2, MuxDown, 50, 50, NO, 0.06);
  at(1, MuxDrag, 2, 0, NO, 0.10);
  at(1, MuxDrag, 3, 0, NO, 0.13);
  check(@"slice handover",
        @"D0,0 G1,0 G2,0 U2,0 D50,50 U50,50 D2,0 G3,0");

  // A cursor's own pick is re-applied before it continues, but only once that
  // cannot read as a double click on the same spot.
  mux = [CursorMux new];
  mux.emit = ^(MuxKind kind, NSPoint point) {
    NSString *name = @[ @"D", @"G", @"U", @"M" ][kind];
    [out addObject:[NSString stringWithFormat:@"%@%.0f,%.0f", name, point.x,
                                              point.y]];
  };
  at(1, MuxDown, 5, 5, YES, 0.00);
  at(1, MuxUp, 5, 5, YES, 0.00);
  at(2, MuxDown, 7, 7, YES, 0.01);
  at(2, MuxUp, 7, 7, YES, 0.01);
  at(1, MuxDown, 50, 50, NO, 0.02);
  check(@"replay waits out the double click", @"D5,5 U5,5 D7,7 U7,7");
  [mux pump:0.50];
  check(@"replay after the double click window", @"D5,5 U5,5 D50,50");

  // A new pick of its own still restores the cursor's earlier picks first.
  at(2, MuxDown, 300, 300, NO, 0.60);
  at(2, MuxUp, 300, 300, NO, 0.61);
  at(1, MuxDown, 9, 9, YES, 0.62);
  [mux pump:1.00];
  at(1, MuxUp, 9, 9, YES, 1.00);
  check(@"own new pick after another cursor",
        @"U50,50 D7,7 U7,7 D300,300 U300,300 D5,5 U5,5 D9,9 U9,9");

  // Hover of a cursor that does not hold the mouse is not sent.
  at(2, MuxMove, 400, 400, NO, 1.10);
  check(@"hover of a waiting cursor", @"");

  if (failures == 0) {
    printf("SELF-TEST OK\n");
  }
  return failures == 0 ? 0 : 1;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0) {
      return SelfTest();
    }
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

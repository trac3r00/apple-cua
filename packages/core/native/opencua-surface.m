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
#include <errno.h>
#include <fcntl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>
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
// Picks this close together are alternatives (tools of one toolbox, swatches
// of one palette): pressing one undoes another.
static const CGFloat kAlternativeDistance = 80;

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
  NSMutableArray<NSValue *> *_hitPoints;
  NSMutableArray<NSNumber *> *_hitTimes;
  NSMutableArray<NSValue *> *_picks;
  int64_t _holder;
  BOOL _down;
  NSTimeInterval _sliceStart;
}

- (instancetype)init {
  self = [super init];
  if (self != nil) {
    _cursors = [NSMutableDictionary dictionary];
    _order = [NSMutableArray array];
    _hitPoints = [NSMutableArray array];
    _hitTimes = [NSMutableArray array];
    _picks = [NSMutableArray array];
  }
  return self;
}

// Every pick pressed on the page, oldest first.
- (void)picked:(NSPoint)point {
  [_picks addObject:[NSValue valueWithPoint:point]];
  while (_picks.count > 64) {
    [_picks removeObjectAtIndex:0];
  }
}

// A cursor's pick must be pressed again only if a nearby alternative was
// pressed after it (or the page never saw it).
- (BOOL)undone:(NSPoint)pick {
  for (NSInteger index = (NSInteger)_picks.count - 1; index >= 0; index -= 1) {
    NSPoint other = _picks[(NSUInteger)index].pointValue;
    CGFloat distance = hypot(other.x - pick.x, other.y - pick.y);
    if (distance < 3) {
      return NO;
    }
    if (distance < kAlternativeDistance) {
      return YES;
    }
  }
  return YES;
}

- (NSArray<NSValue *> *)undonePicksOf:(MuxCursor *)cursor {
  NSMutableArray<NSValue *> *undone = [NSMutableArray array];
  for (NSValue *value in cursor.context) {
    if ([self undone:value.pointValue]) {
      [undone addObject:value];
    }
  }
  return undone;
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

// Presses this close are on the same control: two cursors aim at a swatch or
// tool a pixel or two apart.
static const CGFloat kSameSpot = 7;

- (void)press:(MuxKind)kind at:(NSPoint)point now:(NSTimeInterval)now {
  if (kind == MuxDown) {
    [_hitPoints addObject:[NSValue valueWithPoint:point]];
    [_hitTimes addObject:@(now)];
    while (_hitPoints.count > 64) {
      [_hitPoints removeObjectAtIndex:0];
      [_hitTimes removeObjectAtIndex:0];
    }
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

// Whether a press on this spot now would read as a double click.
- (BOOL)hitRecently:(NSPoint)point now:(NSTimeInterval)now {
  for (NSUInteger index = 0; index < _hitPoints.count; index += 1) {
    NSPoint hit = _hitPoints[index].pointValue;
    if (hypot(hit.x - point.x, hit.y - point.y) < kSameSpot &&
        now - _hitTimes[index].doubleValue < kDoubleClick) {
      return YES;
    }
  }
  return NO;
}

// Whether taking the mouse now would re-apply a pick the page would read as a
// double click.
- (BOOL)canReplay:(NSArray<NSValue *> *)picks now:(NSTimeInterval)now {
  for (NSValue *value in picks) {
    if ([self hitRecently:value.pointValue now:now]) {
      return NO;
    }
  }
  return YES;
}

- (BOOL)takeOver:(int64_t)tag now:(NSTimeInterval)now {
  MuxCursor *cursor = [self cursorFor:tag];
  NSArray<NSValue *> *replay = [self undonePicksOf:cursor];
  if (![self canReplay:replay now:now]) {
    return NO;
  }
  if (_down) {
    self.emit(MuxUp, [self cursorFor:_holder].last);
    _down = NO;
  }
  for (NSValue *value in replay) {
    [self press:MuxDown at:value.pointValue now:now];
    self.emit(MuxUp, value.pointValue);
    [self picked:value.pointValue];
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
      [self picked:event.point];
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

// A pick on a spot pressed within the double-click time would open whatever
// the page shows on a double click (JS Paint: Edit Colors), so it waits.
- (BOOL)mustWait:(MuxCursor *)cursor now:(NSTimeInterval)now {
  MuxEvent *event = cursor.pending.firstObject;
  if (event == nil || event.kind != MuxDown || !event.context) {
    return NO;
  }
  return [self hitRecently:event.point now:now];
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
    BOOL holderWaits = holder != nil && [self mustWait:holder now:now];
    if (keep && !holderWaits) {
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
      if (key.longLongValue == _holder || _cursors[key].pending.count == 0 ||
          [self mustWait:_cursors[key] now:now]) {
        continue;
      }
      if ([self takeOver:key.longLongValue now:now]) {
        switched = YES;
        break;
      }
    }
    if (!switched) {
      if (holder != nil && holder.pending.count > 0 && !holderWaits) {
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

// One line of the agent pointer channel: "<tag> <context> <kind> <x> <y>",
// kind D, G, U or M (down, drag, up, move), x and y in window points from the
// window's top-left corner.
static BOOL ParseAgentLine(const char *line, int64_t *tag, BOOL *context,
                           MuxKind *kind, NSPoint *topLeft) {
  long long value = 0;
  int flag = 0;
  char letter = 0;
  double x = 0;
  double y = 0;
  if (sscanf(line, "%lld %d %c %lf %lf", &value, &flag, &letter, &x, &y) !=
      5) {
    return NO;
  }
  const char *kinds = "DGUM";
  const char *found = letter == 0 ? NULL : strchr(kinds, letter);
  if (value <= 0 || value > 0xffffffffLL || found == NULL || !isfinite(x) ||
      !isfinite(y)) {
    return NO;
  }
  *tag = value;
  *context = flag == 1;
  *kind = (MuxKind)(found - kinds);
  *topLeft = NSMakePoint(x, y);
  return YES;
}

// Agent pointer input sent straight to this process over a Unix socket. The
// window server merges consecutive drag events posted to one app, which mixes
// one cursor's tag with another cursor's position; this channel keeps every
// cursor's events whole and in order.
@interface AgentChannel : NSObject
- (BOOL)listenAt:(NSString *)path
         deliver:(void (^)(int64_t tag, BOOL context, MuxKind kind,
                           NSPoint topLeft))deliver;
@end

@implementation AgentChannel {
  dispatch_source_t _accept;
  NSMutableSet *_clients;
  void (^_deliver)(int64_t, BOOL, MuxKind, NSPoint);
}

- (BOOL)listenAt:(NSString *)path
         deliver:(void (^)(int64_t, BOOL, MuxKind, NSPoint))deliver {
  struct sockaddr_un address;
  memset(&address, 0, sizeof(address));
  address.sun_family = AF_UNIX;
  const char *file = path.fileSystemRepresentation;
  if (strlen(file) >= sizeof(address.sun_path)) {
    return NO;
  }
  strlcpy(address.sun_path, file, sizeof(address.sun_path));
  int listener = socket(AF_UNIX, SOCK_STREAM, 0);
  if (listener < 0) {
    return NO;
  }
  unlink(address.sun_path);
  mode_t previous = umask(0077);
  int bound = bind(listener, (struct sockaddr *)&address, sizeof(address));
  umask(previous);
  if (bound != 0 || listen(listener, 16) != 0) {
    close(listener);
    return NO;
  }
  fcntl(listener, F_SETFL, O_NONBLOCK);
  _deliver = [deliver copy];
  _clients = [NSMutableSet set];
  _accept = dispatch_source_create(DISPATCH_SOURCE_TYPE_READ,
                                   (uintptr_t)listener, 0,
                                   dispatch_get_main_queue());
  __weak AgentChannel *weakSelf = self;
  dispatch_source_set_event_handler(_accept, ^{
    int client = accept(listener, NULL, NULL);
    if (client >= 0) {
      [weakSelf readFrom:client];
    }
  });
  dispatch_resume(_accept);
  return YES;
}

- (void)readFrom:(int)client {
  fcntl(client, F_SETFL, O_NONBLOCK);
  NSMutableData *buffer = [NSMutableData data];
  dispatch_source_t source = dispatch_source_create(
      DISPATCH_SOURCE_TYPE_READ, (uintptr_t)client, 0,
      dispatch_get_main_queue());
  __weak AgentChannel *weakSelf = self;
  __weak dispatch_source_t weakSource = source;
  dispatch_source_set_event_handler(source, ^{
    char chunk[8192];
    ssize_t count = read(client, chunk, sizeof(chunk));
    if (count < 0 && errno == EAGAIN) {
      return;
    }
    if (count <= 0) {
      dispatch_source_t ended = weakSource;
      if (ended != nil) {
        dispatch_source_cancel(ended);
      }
      return;
    }
    [buffer appendBytes:chunk length:(NSUInteger)count];
    [weakSelf drain:buffer];
  });
  dispatch_source_set_cancel_handler(source, ^{
    close(client);
    AgentChannel *strongSelf = weakSelf;
    dispatch_source_t ended = weakSource;
    if (strongSelf != nil && ended != nil) {
      [strongSelf->_clients removeObject:ended];
    }
  });
  [_clients addObject:source];
  dispatch_resume(source);
}

- (void)drain:(NSMutableData *)buffer {
  const char *bytes = buffer.bytes;
  NSUInteger start = 0;
  for (NSUInteger index = 0; index < buffer.length; index += 1) {
    if (bytes[index] != '\n') {
      continue;
    }
    NSUInteger length = MIN(index - start, (NSUInteger)255);
    char line[256];
    memcpy(line, bytes + start, length);
    line[length] = 0;
    int64_t tag = 0;
    BOOL context = NO;
    MuxKind kind = MuxMove;
    NSPoint point = NSZeroPoint;
    if (ParseAgentLine(line, &tag, &context, &kind, &point)) {
      _deliver(tag, context, kind, point);
    }
    start = index + 1;
  }
  [buffer replaceBytesInRange:NSMakeRange(0, start) withBytes:NULL length:0];
  if (buffer.length > 4096) {
    [buffer setLength:0];
  }
}
@end

static AgentChannel *gAgentChannel;

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
- (void)agent:(int64_t)owner
         kind:(MuxKind)kind
           at:(NSPoint)location
      context:(BOOL)context;
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
  MuxKind kind = type == NSEventTypeLeftMouseDown      ? MuxDown
                 : type == NSEventTypeLeftMouseDragged ? MuxDrag
                 : type == NSEventTypeLeftMouseUp      ? MuxUp
                                                       : MuxMove;
  [self agent:owner kind:kind at:event.locationInWindow context:context];
}

// Draws the agent's cursor where its input landed and merges that input with
// every other cursor's into the page's one mouse.
- (void)agent:(int64_t)owner
         kind:(MuxKind)kind
           at:(NSPoint)location
      context:(BOOL)context {
  if (self.cursorLayer != nil) {
    NSNumber *key = @(owner);
    CursorMark *mark = self.cursorLayer.marks[key] ?: [CursorMark new];
    mark.point = [self.cursorLayer convertPoint:location fromView:nil];
    mark.seen = NSDate.timeIntervalSinceReferenceDate;
    mark.down = kind == MuxDown || kind == MuxDrag;
    self.cursorLayer.marks[key] = mark;
    self.cursorLayer.needsDisplay = YES;
  }
  if (self.mux == nil) {
    self.mux = [CursorMux new];
    __weak SurfaceWindow *weakSelf = self;
    self.mux.emit = ^(MuxKind merged, NSPoint point) {
      [weakSelf deliver:merged at:point];
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
  [self.mux cursor:owner
              kind:kind
                at:location
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
  at(2, MuxDown, 25, 5, YES, 0.01);
  at(2, MuxUp, 25, 5, YES, 0.01);
  at(1, MuxDown, 50, 50, NO, 0.02);
  check(@"replay waits out the double click", @"D5,5 U5,5 D25,5 U25,5");
  [mux pump:0.50];
  check(@"replay after the double click window", @"D5,5 U5,5 D50,50");

  // A new pick of its own still restores the cursor's earlier picks first.
  at(2, MuxDown, 300, 300, NO, 0.60);
  at(2, MuxUp, 300, 300, NO, 0.61);
  at(1, MuxDown, 45, 5, YES, 0.62);
  [mux pump:1.00];
  at(1, MuxUp, 45, 5, YES, 1.00);
  check(@"own new pick after another cursor",
        @"U50,50 D25,5 U25,5 D300,300 U300,300 D5,5 U5,5 D45,5 U45,5");

  // Picking a color does not undo the brush: a tool every cursor shares is not
  // pressed again, only the swatch another cursor replaced.
  mux = [CursorMux new];
  mux.emit = ^(MuxKind kind, NSPoint point) {
    NSString *name = @[ @"D", @"G", @"U", @"M" ][kind];
    [out addObject:[NSString stringWithFormat:@"%@%.0f,%.0f", name, point.x,
                                              point.y]];
  };
  at(1, MuxDown, 40, 138, YES, 0.00);
  at(1, MuxUp, 40, 138, YES, 0.00);
  at(1, MuxDown, 73, 1333, YES, 0.00);
  at(1, MuxUp, 73, 1333, YES, 0.00);
  at(2, MuxDown, 40, 138, YES, 0.01);
  at(2, MuxUp, 40, 138, YES, 0.01);
  at(2, MuxDown, 137, 1333, YES, 0.01);
  at(2, MuxUp, 137, 1333, YES, 0.01);
  at(1, MuxDown, 500, 500, NO, 0.60);
  check(@"only replaced picks are pressed again",
        @"D40,138 U40,138 D73,1333 U73,1333 D40,138 U40,138 D137,1333 "
        @"U137,1333 D73,1333 U73,1333 D500,500");

  // Hover of a cursor that does not hold the mouse is not sent.
  at(2, MuxMove, 400, 400, NO, 1.10);
  check(@"hover of a waiting cursor", @"");

  // Two cursors picking the same swatch: the second pick waits out the
  // double-click time while the first cursor keeps drawing.
  mux = [CursorMux new];
  mux.emit = ^(MuxKind kind, NSPoint point) {
    NSString *name = @[ @"D", @"G", @"U", @"M" ][kind];
    [out addObject:[NSString stringWithFormat:@"%@%.0f,%.0f", name, point.x,
                                              point.y]];
  };
  at(1, MuxDown, 73, 1333, YES, 0.00);
  at(1, MuxUp, 73, 1333, YES, 0.00);
  at(1, MuxDown, 100, 100, NO, 0.01);
  at(2, MuxDown, 73, 1333, YES, 0.20);
  at(2, MuxUp, 73, 1333, YES, 0.20);
  at(1, MuxDrag, 110, 100, NO, 0.30);
  at(1, MuxUp, 110, 100, NO, 0.31);
  check(@"same pick by another cursor waits",
        @"D73,1333 U73,1333 D100,100 G110,100 U110,100");
  [mux pump:0.50];
  check(@"same pick after the double click time", @"D73,1333 U73,1333");

  // The same swatch aimed at a pixel apart by another cursor also waits.
  mux = [CursorMux new];
  mux.emit = ^(MuxKind kind, NSPoint point) {
    NSString *name = @[ @"D", @"G", @"U", @"M" ][kind];
    [out addObject:[NSString stringWithFormat:@"%@%.0f,%.0f", name, point.x,
                                              point.y]];
  };
  at(1, MuxDown, 89, 1317, YES, 0.00);
  at(1, MuxUp, 89, 1317, YES, 0.00);
  at(1, MuxDown, 100, 100, NO, 0.01);
  at(2, MuxDown, 90, 1318, YES, 0.20);
  at(2, MuxUp, 90, 1318, YES, 0.20);
  at(1, MuxUp, 100, 100, NO, 0.30);
  check(@"nearby pick by another cursor waits",
        @"D89,1317 U89,1317 D100,100 U100,100");
  [mux pump:0.50];
  check(@"nearby pick after the double click time", @"D90,1318 U90,1318");

  // Lines of the agent pointer channel.
  {
    int64_t tag = 0;
    BOOL context = NO;
    MuxKind kind = MuxMove;
    NSPoint point = NSZeroPoint;
    BOOL parsed = ParseAgentLine("4294967295 1 G 12.5 300", &tag, &context,
                                 &kind, &point);
    if (!parsed || tag != 4294967295LL || !context || kind != MuxDrag ||
        point.x != 12.5 || point.y != 300) {
      failures += 1;
      fprintf(stderr, "FAIL channel line\n");
    }
    const char *bad[] = {"0 0 D 1 1", "4294967296 0 D 1 1", "7 0 X 1 1",
                         "7 0 D 1", "", "7 0 D nan 1"};
    for (size_t index = 0; index < sizeof(bad) / sizeof(bad[0]); index += 1) {
      if (ParseAgentLine(bad[index], &tag, &context, &kind, &point)) {
        failures += 1;
        fprintf(stderr, "FAIL channel accepted \"%s\"\n", bad[index]);
      }
    }
  }

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
    if (argc >= 5) {
      NSString *socketPath = [[@(argv[4]) stringByDeletingLastPathComponent]
          stringByAppendingPathComponent:
              [NSString stringWithFormat:@"surface-%d.sock", getpid()]];
      gAgentChannel = [AgentChannel new];
      __weak SurfaceWindow *target = window;
      if (![gAgentChannel
              listenAt:socketPath
               deliver:^(int64_t tag, BOOL context, MuxKind kind,
                         NSPoint topLeft) {
                 SurfaceWindow *surface = target;
                 if (surface == nil) {
                   return;
                 }
                 NSPoint location = NSMakePoint(
                     topLeft.x, surface.frame.size.height - topLeft.y);
                 [surface agent:tag kind:kind at:location context:context];
               }]) {
        gAgentChannel = nil;
      }
    }
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

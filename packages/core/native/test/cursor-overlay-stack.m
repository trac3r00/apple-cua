#import <Cocoa/Cocoa.h>

// Exercise the pure marker stacking decision without opening any window or
// touching the window server.
#define main CursorOverlayMain
#include "../cursor-overlay.m"
#undef main

static NSDictionary *entry(int pid, int layer, unsigned int number) {
  return @{
    (__bridge NSString *)kCGWindowOwnerPID : @(pid),
    (__bridge NSString *)kCGWindowLayer : @(layer),
    (__bridge NSString *)kCGWindowNumber : @(number),
  };
}

int main(void) {
  @autoreleasepool {
    // Front to back: the user's window, the target's status-level panel, then
    // the target's two normal windows.
    NSArray *stack = @[
      entry(10, 0, 5), entry(20, 25, 6), entry(20, 0, 7), entry(20, 0, 8)
    ];
    NSArray *malformed = @[
      @{(__bridge NSString *)kCGWindowOwnerPID : @(20)},
      @{
        (__bridge NSString *)kCGWindowOwnerPID : @"20",
        (__bridge NSString *)kCGWindowLayer : @(0),
        (__bridge NSString *)kCGWindowNumber : @(3),
      },
      entry(20, 0, 0), entry(20, 0, 9)
    ];
    printf("front-normal=%u\n", marker_target_window(stack, 20));
    printf("absent=%u\n", marker_target_window(stack, 30));
    printf("user-front=%u\n", marker_target_window(stack, 10));
    printf("empty=%u\n", marker_target_window(@[], 20));
    printf("zero-pid=%u\n", marker_target_window(@[ entry(0, 0, 4) ], 0));
    printf("malformed=%u\n", marker_target_window(malformed, 20));
  }
  return 0;
}

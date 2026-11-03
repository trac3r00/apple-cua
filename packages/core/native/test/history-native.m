#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Foundation/Foundation.h>

// Keep the real launch handler, but never request or install a host event tap.
static unsigned int gOfflineTapRequests = 0;
static CFMachPortRef OfflineEventTapCreate(
    CGEventTapLocation tap, CGEventTapPlacement place, CGEventTapOptions options,
    CGEventMask mask, CGEventTapCallBack callback, void *info) {
  (void)tap;
  (void)place;
  (void)options;
  (void)mask;
  (void)callback;
  (void)info;
  gOfflineTapRequests += 1;
  return NULL;
}

static time_t OfflineTime(time_t *destination) {
  const time_t now = 1793534400; // 2026-11-01T12:00:00Z
  if (destination != NULL) {
    *destination = now;
  }
  return now;
}

#define time OfflineTime
#define CGEventTapCreate OfflineEventTapCreate
#define main HistoryRecorderMain
#include "../history-recorder.m"
#undef main
#undef CGEventTapCreate
#undef time

@interface OfflineHistoryDelegate : HistoryRecorderDelegate
@end

@implementation OfflineHistoryDelegate
- (void)buildStatusItem {}
- (void)refreshStatusTitle {}
@end

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 3) {
      return 2;
    }
    NSString *mode = [NSString stringWithUTF8String:argv[1]];
    NSString *root = [NSString stringWithUTF8String:argv[2]];
    @try {
      if ([mode isEqualToString:@"prune"]) {
        gSegmentsDir = [root stringByAppendingPathComponent:@"segments"];
        // 2026-11-01T12:00:00Z. Do not depend on the machine clock.
        PruneOldSegments(1793534400);
      } else if ([mode isEqualToString:@"menubar"]) {
        // Hold the menu bar lock as the running recorder does, until stdin closes.
        AcquireMenubarLock(root);
        printf("%s\n", gMenubarLock >= 0 ? "held" : "busy");
        fflush(stdout);
        char buffer[16];
        while (fread(buffer, 1, sizeof(buffer), stdin) > 0) {
        }
        return 0;
      } else if ([mode isEqualToString:@"tick"]) {
        gRoot = [root stringByAppendingPathComponent:@"cua-history"];
        gSegmentsDir = [gRoot stringByAppendingPathComponent:@"segments"];
        gStatePath = [gRoot stringByAppendingPathComponent:@"state.json"];
        gSettingsPath = [gRoot stringByAppendingPathComponent:@"settings.json"];
        OfflineHistoryDelegate *delegate = [[OfflineHistoryDelegate alloc] init];
        [delegate tick:nil];
      } else if ([mode isEqualToString:@"startup"] ||
                 [mode isEqualToString:@"policy"] ||
                 [mode isEqualToString:@"revoke"]) {
        OfflineHistoryDelegate *delegate = [[OfflineHistoryDelegate alloc] init];
        [delegate applicationDidFinishLaunching:
                      [NSNotification notificationWithName:
                                          NSApplicationDidFinishLaunchingNotification
                                                    object:nil]];
        if ([mode isEqualToString:@"policy"]) {
          [delegate resume:nil];
        } else if ([mode isEqualToString:@"revoke"]) {
          NSData *next = [NSData dataWithContentsOfFile:
                                    [root stringByAppendingPathComponent:
                                              @"next-settings.json"]];
          [next writeToFile:gSettingsPath atomically:YES];
          [delegate tick:nil];
        }
      } else {
        return 2;
      }
    } @catch (NSException *exception) {
      fprintf(stderr, "%s: %s\n", exception.name.UTF8String,
              exception.reason.UTF8String);
      return 1;
    }
    printf("%u\n", gOfflineTapRequests);
  }
  return 0;
}

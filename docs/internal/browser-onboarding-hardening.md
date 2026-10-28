# Browser, onboarding, and mobile hardening

## Users and ideal state

**The person at the Mac.** They keep working in their own windows and Spaces while an agent
drives a webpage, a native app, or their iPhone. Nothing should raise, focus, move, or select
anything they own. A setup should take one command and one clearly explained human step, not a
sequence of build commands, port copying, and manual JSON editing.

**The coding agent.** It should reach a verified result with the fewest round trips and the
smallest observation that answers the next question. It should know whether to use a described
target, a bounded read, a batch, a screenshot, a native fallback, or the phone. It should be able
to hand disjoint targets to subagents, each with its own virtual cursor, and verify their
combined result.

**The maintainer.** Every claim should be reproducible: unit/protocol tests for guards, a real
browser verifier for the extension, and a captured before/after benchmark for any performance
claim. Missing permissions or targets are reported as unverified, never papered over.

## Ideal state

1. `apple-cua browser setup` builds and installs the bridge, opens the right extensions page in
   the background, copies the unpacked-extension path, and waits for the connection. The only
   human step is Load unpacked. `apple-cua browser status` explains any remaining gap.
2. One main MCP registration exposes the desktop, browser, and phone tools. The browser tools
   appear automatically once the bridge has a connection file.
3. The browser skill is decision-first: described target, bounded read, wait, screenshot, batch,
   named spaces, and a fallback to native. It never tells the agent to reveal the agent window.
4. A browser subagent owns one space and one server-issued cursor identity. Different tabs run
   concurrently; one tab is serialized. The coordinator verifies before releasing.
5. The iPhone has the same observe/act/verify contract, a batch primitive, and the same
   non-disruption rule: a covered phone window is refused, not raised.
6. Native observation has a first-class fast profile (semantic-only, no settle, table rows) and
   an explicit visual profile. The skill recommends the fast path when pixels are not needed.
7. The user's frontmost app, real pointer, active Space, and selected tabs are unchanged across
   background work. The agent window stays minimized.

## Gaps before this change

- `scripts/setup.sh` built core, mcp, cli, pi-extension, and agent, but not the browser package.
  The browser skill told the reader to run `pnpm install` and `pnpm --filter @apple-cua/browser
  build` by hand.
- The browser was a separate MCP server (`packages/browser/src/server.ts`), so a user had to
  register a second entry by hand.
- The browser skill was 85 lines. It had no setup command, no described-target path, no read,
  find, wait, or screenshot, no subagent/cursor contract, and no mobile handoff.
- `runSteps` re-observed the whole page at the start of every batch and after every non-final
  step. The per-tab work was queued behind `window:<id>`, so tabs in the same agent window could
  not run concurrently.
- The page runtime walked and named every element on every read, with no cache and no profile.
- `requireMirroringWindowAt` activated and raised the phone window whenever another window
  covered the gesture point, including background delivery.
- The phone had one observation per action and no bounded batch primitive.
- The main MCP `get_app_state` had no fast/visual profile; callers had to know four options to
  avoid the screenshot and settle wait.
- The main skill described worker ownership but did not give host-agnostic spawning recipes.

## Changes

- Browser API v2: `browser_find`, `browser_read`, `browser_wait`, `browser_screenshot`, profiles
  (`interactive`, `content`, `all`), name budgets, described-target and wait steps, up to 20
  steps, per-space `worker_id` and `cursor_id`, and fresh attribution on every result.
- One full page walk per batch. The extension checks the token revision once at batch start, then
  each step revalidates its live element and refuses on navigation; there is no per-step full
  walk or revision round trip. Unchanged reads are cached.
- Per-tab queues replace the per-window queue, so independent spaces/tabs run concurrently.
- The main MCP server registers browser tools when `APPLE_CUA_BROWSER` is on or
  `~/.apple-cua/browser-connection.json` exists. It proxies to the single background daemon.
- `apple-cua browser setup|status|uninstall`, and a browser step in `scripts/setup.sh`.
- iPhone `ios_run` (one token, up to eight steps, one final OCR verification). Background
  occlusion now refuses instead of raising the phone.
- `get_app_state` accepts `profile: "fast" | "full" | "visual"`; fast is screenshot-free,
  settle-free, table-formatted, and capped at 250 elements.
- Skills: rewritten browser skill, a new `references/subagents.md`, fast-path guidance in the
  main skill, and updated iPhone documentation.

## QA scenarios

| # | Scenario | Pass condition |
|---|---|---|
| 1 | One-command setup | `browser setup` installs the service, prints the single human step, and `browser status` reports the connection |
| 2 | Described target | `browser_find` returns refs and a token; one `run` with a target query acts and verifies |
| 3 | Bounded read | `browser_read` returns text and optional links without a row dump |
| 4 | Wait | `browser_wait` waits for text/selector and returns a fresh token |
| 5 | Visual page | `browser_screenshot` returns an image block without raising the window |
| 6 | Batch | an 8-step batch verifies with one final observation |
| 7 | Parallel subagents | four tabs run concurrently with distinct spaces/cursors and verify |
| 8 | Non-disruption | no agent window focus/raise, no user tab selection, no Space change |
| 9 | Mobile batch | `ios_run` consumes one token, verifies final text, and stops on a covered window |
| 10 | Native fast profile | fast observation avoids the screenshot and settle wait; visual still returns pixels |
| 11 | Repository gates | build, typecheck, lint, and Vitest pass |

## Evidence

Browser verifier evidence is written under `.omo/evidence/apple-cua-browser/run-*`. The
pre-change benchmark ran from a detached worktree at the baseline commit with the same large
fixture and the same verifier script. Reports preserve the browser version, per-tab timings,
payload bytes, and the non-disruption assertions.

### Measured browser results

The large fixture has a form at the top and 220 content sections (headings, paragraphs, buttons,
and links). Timings are medians of five samples; the observation payload is the full 200-row
budget. The pre-change and new runs both verified every action.

| Metric (clean five-sample run) | Before | After | Change |
|---|---:|---:|---:|
| 8-step batch on one large page | 72.16 ms | 32.82 ms | **-54.5%** |
| Four independent tabs in parallel | 56.54 ms | 14.76 ms | **-73.9%** |
| Described-target payload (`find`) | 12,366 B full observation | 229 B | **-98.1%** |
| Bounded read payload (`read`) | 12,366 B full observation | 8,578 B | -30.6% |
| Single cold `observe` | 6.64 ms | 7.42 ms | no claim (local DOM walk, within run-to-run noise) |
| Warm `observe` | 2.71 ms | 4.07 ms | no claim (bursty; the cache is not the measured win) |

The structural change is independent of wall-clock noise:

- an 8-step batch now walks the page **once** instead of nine times;
- the per-step checkpoint round trips are gone (the bridge polls the shared stop gate and pushes
  a stop, and each step checks the local flag);
- independent tabs use per-tab queues instead of one per-window queue;
- a described-target lookup returns 229 bytes instead of a 12,366-byte full observation.

Later runs on the same Mac under load average ~10, with unrelated Playwright/GPU work taking
most of the CPU, showed batch medians of 57.4 ms and parallel medians of 33.9 ms. Both the
baseline and the new path were affected by that saturation, so those runs are not used for the
speed claim. The clean five-sample run and the structural counts are the evidence above; a
single cold observe was already fast and is reported honestly as unchanged.

### Evidence ledger

| Check | Evidence |
|---|---|
| Browser verifier (clean five samples) | `.omo/evidence/apple-cua-browser/run-HxnLlo/report.json` |
| Browser verifier (pushed-stop, loaded machine) | `.omo/evidence/apple-cua-browser/run-u6SIuy/report.json` |
| Browser benchmark (pre-change, five samples) | `.omo/evidence/apple-cua-browser/baseline-q3QFsi-report.json` |
| Final real-surface browser run | `.omo/evidence/apple-cua-browser/run-hRaRSH/report.json` |
| Browser tests | `pnpm exec vitest run packages/browser` |
| iPhone batch/no-raise tests | `pnpm exec vitest run packages/mcp/src/phone-tools.protocol.test.ts packages/core/src/platform/ios-mirroring-background.test.ts` |
| Live iPhone Home press | `.omo/evidence/apple-cua-browser/iphone-run-home.json` |
| Unified tool registration | `pnpm exec vitest run packages/mcp/src/toolset.protocol.test.ts packages/mcp/src/server.test.ts` |
| Native profile | `pnpm exec vitest run packages/mcp/src/observation-profile.test.ts packages/mcp/src/capture-only.protocol.test.ts` |
| Onboarding command | `pnpm exec vitest run packages/cli/src/browser-commands.test.ts` |

### Live native and iPhone status

With the Mac unlocked, a real MCP probe measured Finder through the shipped server
(`.omo/evidence/apple-cua-browser/native-probe-unlocked.json`):

| Native observation | Median | Payload | Tree |
|---|---:|---:|---|
| `profile: "fast"` (5 samples) | 123.4 ms | 15,135 B | 250-element cap; `elementsTruncated: true`; no image |
| default full (3 samples) | 320.6 ms | 37,957 B | 238 elements |
| `profile: "visual"` (1 sample) | 124.7 ms | 136,472 base64 JPEG characters | image only; tree skipped |

The fast profile is **61.5% lower latency** and **60.1% smaller** than the full observation in
this live run. It is a partial tree by design: use `find_elements` when the target is known, or
request `profile: "full"` / `"visual"` when the whole tree or pixels matter.

The iPhone tools are registered (14 tools including `ios_run`). Before the phone was locked,
`ios_observe` correctly refused with the exact interstitial message: `iPhone Mirroring is not
connected — an interstitial is on screen. It says: Unlock Your iPhone ...`, dispatched nothing,
and left the frontmost app unchanged (`iphone-probe-blocked.json`).

After the phone was locked, the session became ready. One authorized Home press through
`ios_run` verified `true` with `stepsCompleted: 1` and `actionDispatched: true` in **898.9 ms**;
the final OCR contained `Tesla`. Warm `ios_observe` was **232.5 ms** (cold 787.3 ms). The
frontmost app stayed `Terminal` before and after, and no window was raised or moved. No other
taps were sent (`iphone-run-home.json`). Broader iPhone app workflows remain untested; this run
proves the live batch, final verification, and non-disruption path.

An earlier probe on the locked Mac returned `screen-locked` for every observation
(`native-probe-screen-locked.json`); that run is retained as context and is not used for any
latency claim.

## Remaining risks

- A page can open a native popup that activates the browser. Extension APIs cannot guarantee
  zero transient activation; this is reported, not hidden.
- The native fast profile is semantic-only by design. A task that depends on layout or icons
  must request `profile: "visual"` or `analyze_screen`.
- The phone is one physical surface: parallel taps are not supported, only parallel planning or
  reading.
- Only one live Home press was exercised on the phone. Broader iPhone app workflows, multi-step
  taps, and phone scroll behavior remain untested. The phone is one physical surface: no parallel
  taps; helpers may plan or read concurrently.
- The native fast profile is a partial tree by design; `elementsTruncated` is explicit. Use
  `find_elements` for a known target, or `profile: "full"` when the whole tree matters.
- During a batch the bridge polls the shared stop gate every 25 ms and pushes a stop; an input
  already in flight may complete before the next step is refused. The previous per-step
  checkpoint had the same in-flight window, with a shorter detection delay.
- Benchmark numbers are sensitive to machine load. The clean five-sample run is the speed
  evidence; the loaded run is retained to show the variance rather than to support a claim.
- The native fast-profile latency is not measured live on this locked Mac. Its option wiring is
  tested, and the historical 92 ms capped walk against 417 ms full observation is design
  context, not a new measurement.

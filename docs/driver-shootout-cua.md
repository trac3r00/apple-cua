# Driver shootout: apple-cua vs Cua Driver on one Mac

Measured head-to-head between this repository's macOS driver and **Cua Driver**
([trycua/cua](https://github.com/trycua/cua)'s native macOS driver, `cua-driver-rs-v0.28.2`), both
consumed the way an agent consumes them: as MCP servers over stdio, driven by one identical client,
against identical fixtures, on the same machine, minutes apart.

`driver-scorecard.md` recorded this driver's own numbers and stated plainly that no competitor had
been run. The 2026-09-15 competitive research left the same gap as its lead: *run a driver-level
macOS shootout against Cua Driver*. This is that run, with the numbers both drivers produced.

The short version: on this machine, Cua Driver's MCP surface was faster in every latency dimension
measured, returned sharper screenshots, and could act on a window that was not frontmost. apple-cua
returned roughly 4-5x smaller observation payloads and a full fresh observation with every mutation,
and it refused input into a non-frontmost app rather than acting.

## Versions and provenance

| Field | Value |
|---|---|
| Captured | 2026-09-17T04:45:44Z to 04:49:42Z (head-to-head), 04:50:44Z (in-process reference) |
| Machine | Apple M4, macOS kernel 25.5.0, arm64 |
| apple-cua | repo HEAD `9042620`; MCP server `packages/mcp/dist/server.js` |
| Cua Driver | 0.28.2 stable (`cua-driver-rs-v0.28.2`), daemon in default `standard` permission mode, Accessibility + Screen Recording granted to `CuaDriver.app` |
| Harness | `scripts/measure-cua-shootout.mjs` (Node v26.5.0) |
| Raw data | `.sisyphus/evidence/driver-shootout-cua.json` |
| In-process reference | `.sisyphus/evidence/driver-scorecard.json` (rerun the same hour) |

Cua Driver was updated from the 0.21.0 build already on this machine to the current 0.28.2 through
its own installer before measuring, so this compares current releases rather than a stale install.

## Method

- **One client, one transport.** The harness speaks newline-delimited JSON-RPC 2.0 over stdio to
  both servers. Every number is a full round trip: client -> stdio -> driver -> native -> back.
  The client offered protocol version `2024-11-05`; apple-cua negotiated that version, Cua Driver
  negotiated up to `2025-06-18`.
- **The same call shapes on both sides:** full observation, AX-only observation, capture-only
  (Cua Driver's mirror option; apple-cua serves image-only capture from core, not from its MCP
  surface), and three actions - pixel click, type 45 characters, press one arrow key.
- **Fresh observation before every action,** untimed, because both drivers require one
  (apple-cua: one-use `observation_token`; Cua Driver: a snapshot scoped to `(pid, window_id)`).
- **2 warm-up iterations discarded;** 15 counted observation samples per mode and fixture,
  10 counted action samples per action.
- **Tool failures are never counted as latency.** MCP tool errors arrive as results with `isError`,
  so the harness records them separately; the reported counts show `ok/attempted`.

### Fixtures

| Fixture | Window | Used for |
|---|---|---|
| Finder, repo folder | 920x464 pt, 247 (apple-cua) / 298 (Cua Driver) AX elements | observation |
| TextEdit, scratch file | 656x422 pt, 12 (apple-cua) / 160 (Cua Driver) AX elements | actions |

Both drivers reported the same window title and identical window bounds for each fixture, so both
were observing the same surface. Element counts differ because each driver chooses what to index.

### Deliberate configuration choices

- apple-cua ran with `APPLE_CUA_ALLOWED_BUNDLE_IDS=com.apple.finder,com.apple.TextEdit` (its app
  approval gate refuses every app otherwise) and `APPLE_CUA_DELIVERY=background`.
- Cua Driver ran with its shipping defaults, including `max_image_dimension: 1568` and background
  delivery.
- No screenshot cap was changed on either side.

## Observation latency

Finder (920x464 pt; the app the driver scorecard uses). Milliseconds, p50/p95:

| Mode | apple-cua | Cua Driver |
|---|---:|---:|
| Full observation (AX + screenshot) | 637 / 772 | 499 / 527 |
| AX only (`include_screenshot:false`) | 543 / 717 | 301 / 334 |
| Capture only (no AX walk) | not exposed by its MCP surface | 174 |

TextEdit (656x422 pt):

| Mode | apple-cua | Cua Driver |
|---|---:|---:|
| Full observation (AX + screenshot) | 560 / 794 | 306 / 344 |
| AX only | 513 / 805 | 162 / 196 |
| Capture only (no AX walk) | not exposed by its MCP surface | 110 |

What these numbers include: apple-cua's observation waits for the accessibility tree to go quiet
through its `AXObserver` settle path (53 ms of this run's p50, measured in-process the same hour),
then captures and encodes. Cua Driver walks its AX tree and grabs the window with no separate
settle step. Sample counts are small (15) and these are warm, single-app runs; treat the tails as
indicative.

### Payload of one full observation

| Payload | apple-cua | Cua Driver |
|---|---:|---:|
| Screenshot | 89 KB JPEG, 920x464 (1x points) | 570 KB PNG, 1568x791 (2x, capped from 1840x928) |
| AX text | 69 KB (JSON tree) | 30 KB (markdown tree) |
| Structured AX JSON | 0 KB (tree arrives as text) | 92 KB (`elements[]` with tokens) |
| Whole response | 198 KB | 884 KB |

TextEdit: 59 KB vs 320 KB whole-response. The trade is visible in one row: Cua Driver sends a
Retina-fidelity PNG and both a structured and a markdown tree; apple-cua sends a 1x JPEG and the
tree as JSON text. If a model has to read dense or small UI, the 1568-px image is the difference
between seeing a control and guessing at it.

## Action latency

TextEdit scratch document, same fresh-observation-before-each-action discipline on both sides.
Milliseconds, p50, all runs succeeded (`10/10` both drivers):

| Action | apple-cua | Cua Driver | Response payload |
|---|---:|---:|---|
| Pixel click at the text area's centre | 2,748 | 1,401 | 121 KB vs 244 B |
| Type 45 characters | 2,353 | 1,045 | - |
| Press one arrow key | 2,170 | 1,119 | - |

These are end-to-end tool-call latencies as an agent experiences them: they include each driver's
own pre-flight, delivery routing and post-action verification policy, not raw event-injection cost.
The payload column is a design difference as much as a number: **apple-cua answers a mutation with a
fresh observation** (text plus a new 1x JPEG, 121 KB), while **Cua Driver answers with a compact
verdict** (244 B: route, delivery mode, `effect: "unverifiable"`), leaving the caller to re-snapshot
when it wants pixels.

### The AX rung behaves the same when it fails

Pressed the `AXTextArea` by element id with the app frontmost. Both drivers attempted
`AXUIElementPerformAction(AXPress)` and both surfaced the raw AX error with no false success:

```
apple-cua:   AXUIElementPerformAction failed with AXError -25206
Cua Driver:  AX action failed: AXUIElementPerformAction(AXPress) returned -25206
```

## Background delivery: the clearest behavioural gap

Probe: Finder frontmost, cursor parked at (273, 547); act on a TextEdit window that is *not*
frontmost, then re-read frontmost app and cursor position.

| Step | Frontmost after | Cursor after | Result |
|---|---|---|---|
| Cua Driver observation | Finder | (273, 547) | ok |
| Cua Driver background click | Finder | (273, 547) | `Posted click to pid 76409 (background CGEvent; not driver-verified)` |
| apple-cua click on the same non-frontmost window | Finder | (273, 547) | **refused**: `app-not-frontmost`, `paused: true`, escalation `foreground` |
| apple-cua click after fronting the app | TextEdit | (273, 547) | ok, returns a fresh observation |

Cua Driver posted input into a window the user was not looking at (its own response calls the
result not driver-verified), and left the frontmost app and the real cursor untouched. apple-cua's
MCP surface refused the same action outright: its input preflight requires the target app to be
frontmost, even with `APPLE_CUA_DELIVERY=background`. Neither moved the cursor. If "the agent works
while you work" matters, this is the row to fix first.

## Tool surface

| Dimension | apple-cua | Cua Driver |
|---|---:|---:|
| Tools exposed | 29 | 56 |
| `tools/list` payload | 28.7 KB | 147.8 KB |
| `tools/list` latency | 7.8 ms | 3.0 ms |

Cua Driver's 56 tools cover browser CDP, recording, sessions, and Windows/Linux paths; apple-cua's
29 include the iOS mirroring family. Schema size is context budget: Cua Driver spends ~5x more of
it at handshake.

## One-shot CLI reference (Cua Driver only)

Its supported one-shot mode (`cua-driver call get_window_state ...`) costs process spawn plus IPC:
**345 ms p50** for the same AX-only Finder observation that took 301 ms through the persistent
daemon path. Agents that shell out per step pay ~40-50 ms more per call than the daemon path.

## In-process reference (apple-cua, same hour)

From `docs/driver-scorecard.md` plumbing, rerun at 2026-09-17T04:50Z on the same Finder window:
full observation p50 585 ms, AX-only 533 ms, no-settle 480 ms, settle cost 53 ms, PNG capture
54 ms, JPEG capture 38 ms. The MCP numbers above are 50-90 ms higher than these in-process
numbers - that is the stdio, JSON and base64 layer an MCP client actually pays. Cua Driver has no
equivalent in-process figure here; its measured surface is the daemon/MCP path.

## What changed after this run (same day, same fixtures)

Four measured gaps were closed in this repository's MCP surface and re-measured with the same
harness. Before numbers come from the run above; after numbers from
`.sisyphus/evidence/driver-shootout-after.json` (n=10 observations, 3 actions, 2 warm-ups).

| Dimension | apple-cua before | apple-cua after | Cua Driver 0.28.2 |
|---|---:|---:|---:|
| Finder, full observation p50 | 637 ms | **447 ms** | 494 ms |
| Finder, AX only p50 | 543 ms | 405 ms | 291 ms |
| Finder, capture only p50 | not available | 319 ms | 185 ms |
| TextEdit, full observation p50 | 560 ms | **378 ms** | 341 ms |
| TextEdit, AX only p50 | 513 ms | 347 ms | 188 ms |
| One action answer (click) | 120,649 B | **1,360 B** | 244 B |
| Click on a window that is not frontmost | refused | performed, frontmost app and cursor untouched | performed |
| Tools at handshake | 29 | 30 (added `list_windows`) | 56 |

What each change was:

- **Background input.** With `APPLE_CUA_DELIVERY=background` the input preflight no longer requires
the target app to be frontmost; attended delivery (the default) still refuses. The input controller's
existing guards — approve the app, match the observed window id and bounds, never fall back to global
events — all still run. Evidence: `--foreground-probe` reports
`apple_click_while_background.failed === false` with Finder frontmost and the cursor at (650, 747)
before and after.
- **Compact action answers.** A mutation no longer carries the post-action screenshot unless the
caller asks for it (`include_screenshot: true`), so a verified step costs 1.4 KB instead of 121 KB.
The tree diff, the affected controls and the continuation token are unchanged.
- **Capture-only observation.** `get_app_state { include_accessibility_tree: false }` skips the
accessibility walk and its settle wait and returns the window image with no elements and no
observation token; `settle_ms` is now exposed too. A capture-only answer supersedes the previous
token, exactly like a fresh snapshot, so the refusal path is the familiar "re-observe first".
- **Faster observations.** A probe (`listTopLevelWindows` 183 ms, `getRunningMacOSApps` 0.1 ms,
screenshot 40 ms) showed every observation enumerated the WindowServer window list twice. The
observation now enumerates once and passes that list to both the target-window resolution and the
window inventory: full observations dropped 30-33% on both fixtures, and the before/after gap to
Cua Driver on the Finder window closed from 137 ms to **apple-cua now ahead by 47 ms**.
- **Window discovery.** `list_windows` returns window id, pid, app, title and bounds for every
on-screen top-level window; on the same Finder window it reports window 38574 with bounds
(352, 439, 920x464), identical to Cua Driver's answer. It lists 12 on-screen windows where Cua
Driver lists 103 layer-0 windows including off-screen ones.

What did not close: apple-cua's capture-only path is still ~130 ms slower than Cua Driver's
(319 vs 185 ms) because each observation still pays a ~250-300 ms window-resolution and metadata
base, and its AX walk remains ~100 ms slower. Those are the next two numbers to attack.

## What this does not establish

- **This is one machine, one OS build, two apps, warm runs, small samples.** No confidence
  intervals. The p95 columns collapse toward max at n=15.
- **No task-level benchmark.** Nothing here measures whether either driver completes a real task,
  recovers from stale targets, or survives a moved window. A faster driver can still be the wrong
  driver.
- **Action latency is not event-injection cost.** Both drivers route, verify and (in apple-cua's
  case) re-observe around the action; those policies are part of the number and part of the
  product.
- **Screenshot differences confound the payload comparison.** Cua Driver's images are Retina and
  apple-cua's are 1x points at these defaults. Bytes are not comparable without the fidelity note;
  both are shown above.
- **No cross-platform claim.** Cua Driver's Windows/Linux paths were not exercised, and this Mac
  cannot speak to them.
- **Refusal behaviour is recorded, not explained.** apple-cua's frontmost requirement may be a
  deliberate safety property of its MCP guard rather than a limitation; whatever the intent, it is
  what an MCP client observed.

## Reproducing

```bash
cd /Users/bob/src/apple-cua
node scripts/measure-cua-shootout.mjs \
  --iterations 15 --actions 10 --warmups 2 \
  --out .sisyphus/evidence/driver-shootout-cua.json

# observation-shape probe and the background-delivery probe
node scripts/measure-cua-shootout.mjs --probe
node scripts/measure-cua-shootout.mjs --foreground-probe
```

Preconditions: Cua Driver installed and its daemon running (`cua-driver status`) with Accessibility
and Screen Recording granted to `CuaDriver.app`; `~/.local/bin/cua-driver` on PATH; a Finder window
open on this repo; TextEdit able to open `/tmp/apple-cua-shootout/scratch.txt`. The harness creates
the scratch document, discovers both windows, and only types into that document.

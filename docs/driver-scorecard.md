# Driver scorecard

Driver-level numbers for macos-cua, measured by the harness in
`packages/pi-extension/test/bench/driver-scorecard.test.ts`.

Most computer-use projects publish agent or task scores. Almost none publish driver-level
numbers — how long an observation takes, what it costs to send, how long capture takes — which
is why this file exists. It records what one machine measured, on one day, against one app, and
it states plainly what it does **not** establish.

## Reproducing

```bash
BASELINE_LIVE=1 BASELINE_WRITE=1 npx vitest run packages/pi-extension/test/bench/driver-scorecard.test.ts
```

Without `BASELINE_LIVE=1` the timing test is skipped, so no number is ever produced from a stub.
With `BASELINE_WRITE=1` the run writes `.sisyphus/evidence/driver-scorecard.json`.

## Measurement conditions

| Field | Value |
|---|---|
| Captured | 2026-09-16T02:44:50Z |
| Machine | Apple M4, macOS kernel 25.5.0, arm64 |
| Runtime | Node v22.23.2 |
| Target app | Finder, 361 accessibility elements in the observed window |
| Samples | 7 warm runs per dimension |
| Screenshot | captured by default (`getAppState`), window-scoped |

## Results

Observation latency, milliseconds:

| Dimension | p50 | p95 | min | max |
|---|---|---|---|---|
| Full observation (screenshot + AX) | 479.6 | 646.2 | 442.2 | 646.2 |
| AX only (`include_screenshot: false`) | 416.6 | 533.0 | 404.0 | 532.9 |
| AX only, no settle (`settle_ms: 0`) | 358.4 | 468.8 | 340.0 | 468.8 |
| Settle cost (difference of the two above) | 58.2 | — | — | — |

Capture latency and size at a 1280x800 target:

| Encoding | p50 | p95 | Bytes at this size |
|---|---|---|---|
| PNG | 54.8 | 127.8 | 590,272 |
| JPEG (quality 72) | 42.6 | 45.5 | 170,576 |

Model-facing payload for one full Finder observation:

| Item | Value |
|---|---|
| Screenshot | 296,028 bytes (394,704 base64 chars) |
| Accessibility JSON | 60,648 bytes |
| Tool descriptor schemas | 6,537 bytes (~1,635 estimated tokens) |

## How to read this

- The settle cost of 58.2 ms is one quiet window of the `AXObserver` settle, which is the
  intended shape: it no longer scales with the size of the tree.
- JPEG is both smaller (3.5x at this size) and faster to produce than PNG, and its p95 is far
  tighter.
- The screenshot dominates the payload: 296 KB against 61 KB of accessibility text, so
  `include_screenshot: false` is the cheap re-index and JPEG is the cheap image.
- Sample counts are small (7). The p95 and p99 columns collapse together at this size, so treat
  the tails as indicative, not as an SLA.

## What this does not establish

This is one machine, one app, warm runs, no confidence intervals. In particular it does **not**
measure, and this project therefore cannot claim:

| Dimension | Status |
|---|---|
| Settle precision and recall | not measured — no ground-truth transition traces |
| Click-in-target accuracy | not measured — needs an application-owned oracle, not an API return |
| Action-effect rate | not measured |
| Recovery rate for stale targets, focus loss, permission failure | not measured |
| Stale-target rejection rate on live traffic | protocol tests cover refusal; no live rate |
| Capture fidelity across displays, scales and occlusion | not measured |
| Cold-start and multi-display behaviour | not measured |
| Agent task success | no matched MacAgentBench or macbench run exists for this driver |
| Comparison against any other driver | **no competitor publishes comparable numbers, and none has been run** |

So the numbers above support statements of the form "on this machine, this observation took
this long", and nothing stronger. Claims like fastest, most accurate, or best-in-class are not
supported by this file, and the driver makes no latency comparison against cua-driver, Peekaboo,
Skylight, agent-desktop, Ghost OS or any hosted service until both sides run the same fixtures.

## Next measurements worth adding

1. An application-owned effect oracle, so `effect` outcomes are verified rather than reported.
2. A stale-target fixture that reuses an observation after the UI moved, to turn the protocol
   tests into a live refusal rate.
3. Capture fidelity checks across Retina scales, secondary displays and occlusion.
4. A matched head-to-head run against at least one other driver on identical fixtures.
5. macbench or MacAgentBench subsets with a fixed model and prompt set, to connect driver
   timings to task outcomes without conflating them.

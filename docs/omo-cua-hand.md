# OMO’s computer-use hand

Research date: 2026-09-17. Job: give **OMO / lazygrok / Grok Build** a local way to see and act on this Mac (and, if needed, a real iPhone). This is not an OSWorld ranking and not “most GitHub stars.”

Cited claims are in the [verified-claims](../.omo/lazygrok/ulw-research/20260917-052821/claim-graph.md) digest. High-risk “best” sentences that failed review are not used here.

## Executive verdict

**Native OMO has no local computer-use driver.** Isolated lazygrok MCP is `omo-lsp` + `omo-ast-grep` + `groken`. `grok mcp list` is empty. `groken-cua` is the groken skill’s **Bot cloud desktop** path and is not installed here. [`V3`][V3] [`V4`][V4]

Two real host-native MCP hands exist on this machine:

| Hand | What it is | What it is not |
|---|---|---|
| **Cua Driver 0.28.2** | Installed, signed `CuaDriver.app`, daemon running, 56 MCP tools, background-first, official Grok Build how-to | Not deny-by-default; not iPhone Continuity; ~5× `tools/list` |
| **apple-cua MCP (working tree)** | This repo: 30 tools, one-use tokens, empty allowlist = no apps, compact mutations, `ios_*` | Not registered in OMO; unsigned TCC; MCP cannot select `window_id`; dirty tree vs HEAD `9042620` |

**Wiring this week (install fact, not a quality ranking).** Cua Driver is already on PATH and documented as:

```bash
command -v cua-driver
grok mcp add cua-driver -- /absolute/path/to/cua-driver mcp
```

The command is documented on cua.ai. [`V8`][V8] The `grok mcp add` verb itself is a Grok client feature (Playwright MCP’s README uses the same shape). It is not a Cua monopoly. apple-cua is equally attachable as `node …/packages/mcp/dist/server.js` once someone registers it. Nobody has. [`V3`][V3]

**Owned path (product bet, not a measured “best”).** If the job is a guarded, low-context Mac+phone hand that OMO vendors, apple-cua is the only candidate that is (a) this codebase, (b) default-deny [`V11`][V11], (c) ~30 tools [`V5`][V5], (d) iPhone Mirroring via Screen Continuity [`V10`][V10]. Cua Driver still wins signed TCC, default background, Retina screenshots, CDP/recording, and release cadence. Peekaboo is the largest public non-Cua Mac MCP (5174★) and was not shootout-tested. [`V7`][V7]

**Do not run two desktop drivers in one session.** That is apple-cua’s own skill rule, not a measured race. Compose **Playwright MCP** for the browser, not a second CGEvent owner.

Nightly Cua **0.28.3** is not the stable `cua-driver-rs-v*` channel. [`V2`][V2] Stay on 0.28.2 unless you want the opt-in macOS **Computer History** preview (metadata-only; cloned driver README). Driver PRs in that nightly are mostly Hyprland/X11/UIA (debate C1b).

## Scorecard (OMO-hand job)

Scores are 1–5 for *this job*. **U** = not measured here. Means are not “best.”

| # | Criterion | apple-cua WT | Cua 0.28.2 | native OMO | Peekaboo | Playwright MCP |
|---|---|---:|---:|---:|---:|---:|
| 1 | MCP stdio OMO can spawn | 5 | 5 | 1 | 5 | 5 |
| 2 | Context cost | 5 | 2 | 1 | U | U |
| 3 | Guarded personal Mac | 4 | 3 | 1 | U | 4 |
| 4 | Observation (AX + pixels) | 3 | 4 | 1 | U | 2 |
| 5 | Closed-loop effect/verify | 4 | 4 | 1 | U | 3 |
| 6 | Background delivery | 4 (env) | 5 (default) | 1 | U | 4 |
| 7 | Loop latency | 3 | 4 | U | U | U |
| 8 | Install / TCC identity | 2 | 5 | 1 | U | 4 |
| 9 | OMO/lazygrok packaging | 3 | 4 | 2 | 1 | 4 |
| 10 | Unique surfaces | 4 (iPhone) | 4 (CDP, Win/Linux) | 2 | U | 4 (browser) |
| 11 | Maintenance / releases | 2 | 5 | 1 | 4 | 5 |

Evidence for the numeric cells is below. Peekaboo MCP exists; latency/bytes were not measured → remaining cells U.

### Context and latency (MEASURED, one Mac, 2026-09-17)

From [`docs/driver-shootout-cua.md`](driver-shootout-cua.md) and `.sisyphus/evidence/driver-shootout-after.json` (n=10 observations, 3 actions, dirty tree vs Cua 0.28.2). Not a task-success benchmark. p50 ranges overlap on full observation.

| Dimension | apple-cua after | Cua Driver 0.28.2 |
|---|---:|---:|
| Finder full observation p50 | 447 ms | 494 ms |
| Finder AX-only p50 | 405 ms | 291 ms |
| Finder capture-only p50 | 319 ms | 185 ms |
| Click answer payload | 1,360 B | 244 B |
| `tools/list` | ~29 KB / 30 tools | 147.8 KB / 56 tools |
| Full Finder observation bytes (before compact era) | 198 KB (1× JPEG) | 884 KB (2× PNG, 1568 cap) |
| Background click, other app frontmost | performed when `APPLE_CUA_DELIVERY=background` | performed by default |

[`V6`][V6] apple-cua’s 447 vs 494 ms is **not** a ranking win. Capture-only and AX-only still trail. Screenshot fidelity is the other half: Cua’s 1568-px PNG vs apple-cua’s 1× JPEG.

## Native OMO

Isolated Grok Build on this machine:

- Plugin MCP: `omo-lsp`, `omo-ast-grep`, `groken` (Bot chat, not local CGEvent).
- `grok mcp list`: no servers.
- `~/.agents/skills/computer-use` is ignored by isolation.
- `groken-cua` is documented as **Bot desktop computer-use** (xdotool/VNC on the cloud computer). Binary missing.
- Hermes on this machine has a stale `macos_cua` path at `/Users/bob/src/macos-cua/…` — that is Hermes, not this session.
- apple-cua **pi-extension** is a Pi in-process hand (19 tools + live Anthropic `computer_20250124`). OMO does not load Pi. OpenAI native `computer_call` is **off** because pi-ai 0.73.1 has no `computer_call` transport.

OMO’s missing piece is not a model. It is a **stdio MCP driver** plus a skill the isolated catalog will load.

## apple-cua (this repo)

HEAD `9042620`. Working tree already contains the same-day MCP changes the shootout called “after”: `list_windows`, capture-only, compact mutation answers, background when `APPLE_CUA_DELIVERY=background` ([S5][S5], [V6][V6]). MCP tool count is 30. [`V5`][V5]

**What OMO would actually get**

- Stdio MCP: `node packages/mcp/dist/server.js`
- 30 tools: 18 desktop + 12 `ios_*`. No MCP `ios_status` (CLI-only; skills still name it).
- One-use `observation_token` per pid. Capture-only issues no token.
- `APPLE_CUA_ALLOWED_BUNDLE_IDS` empty → no Mac app may be observed or clicked. iOS, `list_apps`, `list_windows`, `clipboard_read` are not on that allowlist. [`V11`][V11]
- Mutations return `effect` / `route` / `delivery` / `evidence` / `escalation`. Default: no screenshot, no full tree (~1.4 KB).
- `set_fields` (≤10 verified writes) and `run_steps` (≤10 + `expect`) exist on MCP, not on pi-extension.
- iPhone: `com.apple.ScreenContinuity`, Vision OCR, SkyLight mouse records, one-use phone tokens. Code-backed, not live-probed this session. [`V10`][V10]

**Broken contract vs docs**

- README and the skill say pass `window_id` on `get_app_state`. MCP schema and handler do not. Pi-extension does. `list_windows` therefore cannot be followed by a targeted observe. [`V5`][V5]
- README comparison table still quotes pre-fix 637 ms / 2.2–2.7 s.
- Mutation envelope hardcodes `delivery: "background"` even when attended.
- Default MCP delivery is **attended** (`native-policy.ts`). OMO would steal focus unless the host sets the env.
- TCC attaches to whatever launched Node (Terminal vs lazygrok binary vs IDE). Not a signed helper.

## Cua Driver (latest)

On this Mac: **0.28.2** stable, daemon running, `standard` permission mode. [`V1`][V1] Live `cua-driver status` (2026-09-17T05:52Z) reported pid 68029; Accessibility + Screen Recording on `CuaDriver.app`.

GitHub: [trycua/cua](https://github.com/trycua/cua) 22,735★, MIT, pushed 2026-09-17. [`V7`][V7] Latest `cua-driver-rs-v*` tag is **v0.28.2** (2026-09-15). Nightly tag `nightly-cua-driver-rs-v0.28.3-nightly.20260917.35182198280` is not that channel. [`V2`][V2]

Live product page: “Background hands for any agent.” MCP or CLI, window-targeted input, cursor stays put. [`V9`][V9]

**What OMO would actually get**

- `cua-driver mcp` stdio (proxies to the app so TCC stays on the bundle).
- 56 tools: window/AX, input, browser CDP, recording, sessions, overlay cursor, `verify_state`, `kill_app`, `bring_to_front`.
- Default `delivery_mode=background`. Foreground is explicit.
- `get_window_state(pid, window_id)` — the window-id OMO actually needs.
- `standard` is promptless for routine input. `bounded` + capability manifest is the tighter mode; it is extra setup.
- Skill install auto-links Claude Code, Codex, Prime, OpenClaw, OpenCode, Antigravity, Hermes. **lazygrok is not a skill target.** Grok Build is a separate how-to: `grok mcp add` (see above). [`V8`][V8]
- Telemetry on by default (`cua-driver telemetry disable`).

**Not in the 56:** iPhone Mirroring / Continuity. Cua’s marketing example is **iPhone Simulator**, a Mac window.

## Popular GitHub CUAs

Star count is popularity. Class **A** = macOS host MCP/driver OMO could attach.

Stars below are only from [V7][V7] or `browse/github-cua-index.json` (live `gh api` / rendered GitHub, 2026-09-17). Other A-class peers are named without counts.

| Repo | Stars | Class | OMO-hand |
|---|---:|---|---|
| bytedance/UI-TARS-desktop | 39015 | B agent app | not an MCP driver (can operate a GUI as a product) |
| microsoft/playwright-mcp | 37189 | C browser MCP | **browser complement**; `grok mcp add playwright` |
| trycua/cua | 22735 | A/B platform | Cua Driver is the attachable piece |
| simular-ai/Agent-S | 12313 | B agent | replaces OMO, not a hand |
| CursorTouch/Windows-MCP | 7024 | D Windows | Windows analog |
| openclaw/Peekaboo | 5174 | **A** | `peekaboo mcp` / `npx @steipete/peekaboo mcp` |
| injaneity/pi-computer-use | 1950 | A-for-Pi | Pi extension, not MCP |
| lahfir/agent-desktop | 1160 | A design | AX stable refs; **no MCP at HEAD SHA** |
| xlang-ai/OpenCUA | 839 | B/E | models + bench |

Also classified (no star counts in this table): browser-use (C), OmniParser (B, eyes only), bytebot (D, archived Linux VM), microsoft/fara (B, web CUA), iFurySt/open-codex-computer-use (A, Codex-shaped MCP), ghostwright/ghost-os (A, last push 2026-03), PallavAg/claude-computer-use-macos (A demo, stale 2024-10, pyautogui).

Rendered GitHub pages: `.omo/lazygrok/ulw-research/20260917-052821/browse/github-*.png`.

**Peekaboo** (SHA `4d3c92ea…`, macOS 15+): ScreenCaptureKit + AX, background-only MCP catalog, snapshot receipts, signed app path. Largest public non-Cua Mac MCP. No numbers vs apple-cua on this Mac. Do not switch on stars.

**agent-desktop** (SHA `7a8e4a10…`, pushed today): skeleton refs `@s8f3k2p9:e1`, headless AXPress. Capture is still `screencapture`. MCP is docs-only at this SHA. Steal the ref design.

## What apple-cua must ship to be OMO’s hand

These are product gaps against the OMO job and against Cua/Peekaboo. They are not a promise of “best.”

### P0 — wire and stop lying

1. **Register in OMO.** `grok mcp add apple-cua -- node /abs/packages/mcp/dist/server.js` (or a lazygrok plugin MCP entry). Isolated sessions currently load zero CUA. Until this exists, Cua is the only installed hand.
2. **Signed TCC helper `.app`.** Grants must attach to a stable bundle, not Terminal/Node/gateway. This is Cua’s actual install win (`com.trycua.driver`).
3. **Commit the working tree** (background, compact answers, capture-only, `list_windows`). HEAD `9042620` is not what the shootout-after describes.
4. **MCP `window_id` on `get_app_state`.** Core and pi-extension already have it. README already claims it. Schema does not. [`V5`][V5]
5. **OMO profile defaults:** require allowlist, `APPLE_CUA_DELIVERY=background`, honest `delivery` in the envelope (today hardcoded `"background"`).
6. **Docs = code.** Drop stale 637 ms table; remove `ios_status` from MCP docs or implement it; stop advertising `window_id` on MCP until it exists.

### P1 — close the measured gaps

7. **Retina / scale-aware window shots.** 1× JPEG vs Cua 1568-px PNG is why dense UI is unreadable, not a model failure.
8. **Capture-only and AX-walk latency.** 319 vs 185 ms and 405 vs 291 ms remain after the window-list reuse. Preflight still re-lists windows.
9. **Structured `elements[]`** (id, role, label, value, actions, frame) plus a short tree — Cua already sends both.
10. **Keep `tools/list` small.** Gate `ios_*` behind an env. Do not grow to 56 tools. CDP belongs in Playwright MCP.
11. **`apple-cua doctor`:** TCC identity of the *actual* launcher, allowlist, delivery, Screen Recording effective-after-restart.
12. **`ios_status` as a real MCP tool.** Phone mutations still dump full OCR every turn — compact them the way Mac mutations were compacted.
13. **Snapshot receipts** (Peekaboo `ps1_` + window identity) so stale targets refuse the way tokens already do.
14. **Lazygrok skill** in the isolated catalog (`skills/apple-cua` is OpenClaw/Hermes-shaped today).
15. **Re-measure action p50** after compact answers (currently unknown; pre-compact click was 2.7 s vs Cua 1.4 s because of a 121 KB re-observation).

### P2 — strategic, not this week

16. Optional **bounded** allowlist file (Cua’s permission-mode idea without shipping `kill_app` in the default set).
17. Mark OpenAI native `computer_call` unsupported until pi-ai can round-trip it — or implement the transport.
18. `VMComputer` / `CloudComputer` are abstract classes, not Qemu stubs. Implement or delete the README row.
19. Do not add recording/CDP/Windows inside apple-cua; compose Cua or Playwright for those jobs.
20. Task-level subset (open this, type that, `verify_state`) so driver p50s connect to outcomes. No MacAgentBench numbers exist for this driver.

## How to give OMO a hand *today*

Pick **one** desktop MCP. Then optionally add Playwright for the browser.

**Off-the-shelf desktop (already installed here):**

```bash
command -v cua-driver
grok mcp add cua-driver -- "$(command -v cua-driver)" mcp
cua-driver telemetry disable   # optional
```

Use Cua `bounded` + a reviewed manifest on a personal Mac if `standard` (promptless, includes `kill_app`) is too wide.

**Owned apple-cua desktop + phone:**

```bash
pnpm --filter @apple-cua/core --filter @apple-cua/mcp build
grok mcp add apple-cua -- node /Users/bob/src/apple-cua/packages/mcp/dist/server.js
```

Host env (example — use the user’s apps, not this list):

```text
APPLE_CUA_ALLOWED_BUNDLE_IDS=com.apple.finder,com.apple.TextEdit
APPLE_CUA_DELIVERY=background
```

Grant Screen Recording + Accessibility to **the process that launches Node**, then restart it.

**Browser complement:**

```bash
grok mcp add playwright -- npx @playwright/mcp@latest
```

## Sources

| id | locator | retrieved |
|---|---|---|
| V1–V11 | [claim-graph](../.omo/lazygrok/ulw-research/20260917-052821/claim-graph.md) | 2026-09-17 |
| S1 | https://github.com/trycua/cua | gh api 05:52Z |
| S2 | https://cua.ai/cua-driver | live Playwright PNG + fetch |
| S3 | https://cua.ai/docs/use-cua-with/grok-build.md | HTTP 200 05:52Z |
| S4 | https://github.com/openclaw/Peekaboo | 5174★, MCP README, screenshot |
| S5 | `docs/driver-shootout-cua.md` + `driver-shootout-after.json` | this Mac 05:15Z |
| S6 | `packages/mcp/src/tool-names.ts`, `tool-schemas.ts` | working tree |
| S7 | grok-home `config.toml`, `grok mcp list` | 05:52Z |
| S8 | cua-driver `list-tools` / `status` / `skills status` | 0.28.2 live |
| S9 | `/tmp/omo-cua-peers/*` SHA-pinned clones | Peekaboo, pi-computer-use, agent-desktop |
| S10 | Momus + re-fetch children | session 01a0add4-… |

## Methodology and limits

- One machine (Apple M4, macOS 25.5.0). Shootout: Finder + TextEdit, warm runs, small n. No confidence intervals, no task success.
- “Latest” Cua = installed 0.28.2 + latest `cua-driver-rs-v*` tag. Nightly 0.28.3 was not installed.
- apple-cua numbers labeled “after” are the **dirty tree**, not committed HEAD.
- iPhone tools were audited in code, not exercised on a phone this session.
- Peekaboo / agent-desktop / pi-computer-use were cloned and READMEs read; no MCP latency shootout.
- Grok librarian children in this launch had no `gh`/`web_fetch`; those axes were re-run on unspecified-high + parent browsing.
- Vendor pages rendered live (Playwright / agent-browser). The skill engine failed without `curl_cffi`; that is labeled, not substituted as live HTML.

[V1]: ../.omo/lazygrok/ulw-research/20260917-052821/claim-graph.md
[V2]: ../.omo/lazygrok/ulw-research/20260917-052821/claim-graph.md
[V3]: ../.omo/lazygrok/ulw-research/20260917-052821/claim-graph.md
[V4]: ../.omo/lazygrok/ulw-research/20260917-052821/claim-graph.md
[V5]: ../.omo/lazygrok/ulw-research/20260917-052821/claim-graph.md
[V6]: ../.omo/lazygrok/ulw-research/20260917-052821/claim-graph.md
[V7]: ../.omo/lazygrok/ulw-research/20260917-052821/claim-graph.md
[V8]: ../.omo/lazygrok/ulw-research/20260917-052821/claim-graph.md
[V9]: ../.omo/lazygrok/ulw-research/20260917-052821/claim-graph.md
[V10]: ../.omo/lazygrok/ulw-research/20260917-052821/claim-graph.md
[V11]: ../.omo/lazygrok/ulw-research/20260917-052821/claim-graph.md

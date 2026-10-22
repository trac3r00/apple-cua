# Expectation contract: parallel, background, self-refreshing apple-cua

Status: active (2026-10-22). Source: user request in OmO session 01a1619b
(prompt-builder + loe + fdd + preflight), items 1-4.

## Outcome and intended users

- **Host agents** (OmO/senpi, Codex, Claude Code, Pi, OpenClaw, Hermes) that drive
  apple-cua over MCP. They need to know which harness they are in, how to fan out one
  subagent per worker in that harness, and to pay fewer tokens and less wall time per
  observed action.
- **The person at the Mac.** Their screen, cursor and focus stay theirs. They can take
  over the agent's browser and give it back, and the agent respects that. They never
  need to restart a session because apple-cua was updated, crashed, or was just granted
  a permission.

## In scope

1. Host-harness detection and per-host worker spawn guidance; worker observations
   without screenshots by default (latency and tokens).
2. Smaller `tools/list` payload for the full and lean toolsets.
3. Browser take-over / give-back / agent-requested handoff, respected by the agent.
4. A stdio supervisor that keeps the client connection alive across server crashes,
   rebuilds and permission grants, and tells the client to re-list tools.

## Out of scope / constraints

- No new runtime dependencies. No change to the signed helper's Info.plist or launcher
  (that would cost the person their Accessibility and Screen Recording grants).
- Never replay an action whose outcome is uncertain. Tokens from a previous server
  child are invalid after a restart.
- Native hardware cursor stays singular. Worker cursors are logical identities.
- A private-API virtual display is not built unless the user chooses it (EXP-010).
- Tests follow repository conventions: Vitest, `#given #when #then` names, no fixed
  sleeps as synchronization.

## Requirements

| ID | Requirement (source) | Start + action | Pass observable | Evidence |
|---|---|---|---|---|
| EXP-001 | Know the harness (req 1) | Client initializes with clientInfo `claude-code` / `codex-mcp-client` / `apple-cua-pi-extension`, or with no known name but a host env marker; call `get_capabilities` | `host.name` is `claude-code` / `codex` / `pi` / `omo` / ...; `host.source` is `client_info` or `environment`; unknown is `unknown`, never a guess | protocol test |
| EXP-002 | Spawn one subagent per worker (req 1) | Detected host; `manage_workers` assign 2 apps | Result carries `spawn` naming that host's mechanism and whether input runs concurrently (background) or serialized (attended) | protocol test; skill reference |
| EXP-003 | Lower latency + tokens for workers (req 1, 2) | assign/observe worker without `include_screenshot` | No image content and the observation was requested with `includeScreenshot: false`; `include_screenshot: true` still returns an image | protocol test |
| EXP-004 | Workers really run in parallel (req 1) | Background delivery, two workers on distinct apps, first run blocked in the fake | Second worker's run dispatches before the first finishes; attended stays serialized | protocol test |
| EXP-005 | Token cost of tool list (req 2) | List tools for full and lean | full <= 32,000 bytes (was 39,919; measured 31,799), lean <= 10,500 (was 10,234; measured 9,156); the step shape is published once (run_steps) and every run_parallel/run_worker step is still validated strictly before dispatch | compact-schema test |
| EXP-006 | Human can interrupt the browser (req 3) | Extension sends take-over | `browser_status.control` is `human`; `browser_open`/`browser_run` fail with `human_control` and send no command; observe/close still allowed | browser unit tests |
| EXP-007 | Human can give it back (req 3) | After take-over, extension sends give-back | `control` is `agent`; a fresh observe + run succeeds; no agent-callable tool or RPC can set `control` to `agent` | browser unit tests |
| EXP-008 | Agent can ask for a handoff without bothering the screen (req 3, 4) | Agent calls `browser_handoff` with a reason | Extension receives `handoff` with the reason (badge/popup only, no window focus or reveal); status shows `handoff_requested` | browser unit tests + extension test |
| EXP-009 | Agent respects the handoff (req 3) | Agent calls `browser_wait_control` with timeout | Resolves `control: agent` as soon as give-back arrives; at timeout returns `control: human` without error; bounded <= 120 s; event-driven | browser unit tests |
| EXP-010 | Side space, Cua Driver model (req 3, 4; user named Cua Driver) | Background `open_app` of an app that activates itself on launch while the person's app is in front | The person's previous front app is reactivated and the answer says `frontmostRestored: true` (false when it refuses); attended opens are never touched; agent work stays in windows behind the person's (existing background delivery, cross-Space targeting, minimized agent browser window) | open-app unit tests |
| EXP-011 | Crash does not end the session (req 4) | Supervised child exits while a call is in flight | Client stays connected; in-flight call gets an error saying the outcome is unknown and to re-observe (not replayed); next call is served by a fresh child; client got `notifications/tools/list_changed` | supervisor tests |
| EXP-012 | Update refreshes the running server (req 4) | Watched build output changes during an in-flight call | Restart waits until no call is in flight, then new child serves; `list_changed` sent | supervisor tests |
| EXP-013 | Permission approval refreshes the running server (req 4) | Child reported a missing permission; probe now reports it granted | Child restarted when idle | supervisor tests |
| EXP-014 | No orphans, no crash loop | stdin EOF; or child crashes repeatedly | Child and supervisor exit; crash loop stops after the limit with nonzero exit and a stderr reason | supervisor tests |
| EXP-015 | Client is told list can change | initialize through supervisor | initialize result has `capabilities.tools.listChanged: true` | supervisor test |
| EXP-016 | Real chain works | Signed wrapper launches supervised server | `get_capabilities` reports the same granted permissions as before; touching the build triggers one restart and a `list_changed`, then `list_apps` works | native QA log (read-only tools) |
| EXP-017 | Framing is robust (FDD) | Generated JSON-RPC streams split at arbitrary byte boundaries, batched, with unicode | Router output equals an independent model; malformed lines are rejected without killing the session | property test with seed |
| EXP-018 | Release gate | `node scripts/preflight.mjs` | Exit 0 only when mapped checks pass; nonzero on failure, missing tool, stale sources | gate + negative cases |
| EXP-019 | No regressions | `pnpm check` | Exit 0 | command log |

## Threshold note

EXP-005 numbers are proposed by the implementer, not a project or user value. The first proposal
(full <= 30,000) was revised to 32,000 after measurement: descriptions were shortened and the
duplicated step schema removed (-20% full, -11% lean); going further would cut behavioral facts
models need from tool descriptions.

## Assumptions

- Claude Code sends clientInfo name `claude-code`; Codex sends `codex-mcp-client`
  (observed client names; detection falls back to `unknown`, never misattributes).
- Screen Recording grants need a process restart to take effect; Accessibility usually
  does not. EXP-013 restarts on either.

## Decisions

- EXP-010: the user named Cua Driver (cua.ai) as the reference. Its model is "windows
  behind yours, a cursor of its own, a browser window of its own", with the known limit
  that launching an app can raise its window
  (https://cua.ai/docs/cua-driver/concepts/how-cua-driver-works). apple-cua already
  matches the first three; EXP-010 closes the launch limit. No virtual display is built.

## Work plan (parallel tracks, disjoint write scopes)

- [x] T1 host detection module (`host-detection.ts`) - EXP-001
- [x] T2 wire host into `get_capabilities` and `manage_workers` assign - EXP-001, EXP-002
- [x] T3 worker observations without screenshots by default - EXP-003, EXP-004
- [x] T4 shrink `tools/list` and lower budgets - EXP-005
- [x] T5 background `open_app` restores the person's front app - EXP-010
- [x] T6 browser daemon: control state, handoff, wait - EXP-006..009
- [x] T7 browser extension: popup Take over / Give back / Stop, handoff badge - EXP-006..008
- [x] T8 stdio supervisor + framing property test - EXP-011..015, EXP-017
- [x] T9 wire supervisor into `server.ts` entry; native QA through signed wrapper - EXP-016
- [x] T10 skill docs: per-host spawn recipes, browser take-over/give-back, refresh behavior
- [x] T11 `scripts/preflight.mjs` gate + negative cases - EXP-018
- [ ] T12 `pnpm check` - EXP-019

Each track is verified by the parent re-running its tests, not by the worker's report.

## Done when

Every EXP except blocked EXP-010 passes with the listed evidence, `scripts/preflight.mjs`
exits 0 and its negative cases fail as specified, and `pnpm check` exits 0.

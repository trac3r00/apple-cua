# One macOS computer-use stack: what apple-cua took from Codex, Cua Driver and OmO

Measured 2026-10-05 on an Apple M4, console session, background delivery. Three reference stacks were
inspected and run on this Mac:

- **Codex computer use** (`cua_repl` from ChatGPT.app's `unified-computer-use` plugin 26.928.20755, registered
  in OmO as the user MCP server `codex-cu` with the plugin's own command, args and env).
- **Cua Driver** from [trycua/cua](https://github.com/trycua/cua) (source at `f68b806`, contract
  `libs/cua-driver/contract/manifest.json`: 29 tools).
- **OmO's `computer` tool** (Quartz backend; `capabilities()` reports background window input, a focus guard and a
  global stop path).

## What each one does best, and where it now lives in apple-cua

| Strength | Reference | apple-cua |
|---|---|---|
| A whole flow with loops and reads in one call | Codex `js` REPL, OmO `computer.run` | `run_script`: one JavaScript body, `apple.app(name)` handles; every action is token-guarded, allowlisted, preflighted and verified like `run_steps`; refusals throw a catchable `ScriptActionError` |
| The person can stop every agent from the keyboard; only the person resumes | OmO stop chord, Codex "Esc to cancel" | Global stop switch: hold Control+Option+Command (read from HID state, no extra permission), or `apple-cua stop`; file-backed (`~/.apple-cua/stop.json`, `APPLE_CUA_STATE_DIR`) so every apple-cua server obeys; mutations refuse with `user-stopped`, batches stop between steps, reads keep working; `apple-cua resume` / `apple-cua stop-status` |
| One read-only call that says what is possible here | OmO `capabilities()`, Cua Driver health/permission report | `get_capabilities`: Accessibility and Screen Recording, locked/console/remote session, display size, delivery mode and focus guarantee, approved apps, stop state, and `advice` |
| The guide travels with the server | Cua Driver `skill://cua-driver/SKILL.md` resources | `skill://apple-cua/SKILL.md` and `skill://apple-cua/references/*.md` served over MCP `resources/*` |
| Token-cheap observation | Codex tree diffs | already present: `diff_only`, `element_format: "table"` |
| Exact-window background input | Cua Driver background-input plan | already present (bench-v2 105/105 on console) |

Beyond the three: guarded tokens on every mutation, per-action outcome envelopes, `verify_state`/`expect`,
`set_fields` read-back, `observe_apps`/`run_parallel`, `ask_user` elicitation, iPhone Mirroring tools, and a drawn
agent cursor.

## Head-to-head: Calculator 12 x 12 in the background

Same Mac, same window state (sidebar hidden), run back to back, n=1 each. Each run first cleared the display and read
it back (all three read `0`), then pressed 1 2 x 1 2 = and read `144`. Terminal stayed frontmost in every run.

| Stack | Tool calls | Wall time | Answer size | Per-action guard and verification |
|---|---|---|---|---|
| apple-cua `run_script` | 1 | 2.41 s | 835 B | yes: each click re-resolved against a fresh read, token-checked, allowlisted, and answered `observed_change` |
| Codex `cua_repl` (`codex-cu`) | 2 (`getApp`, then clicks) | 2.70 s | 1.5 KB + 43 B (first call of a fresh session is ~20 KB with docs) | no; element numbers must come from the latest tree |
| OmO `computer.run` | 1 | 1.90 s | 71 B | no; caller must re-find elements |

What broke along the way (all fixed in the harness, not hidden):

- OmO's first attempt collected the buttons once and failed on the second press with `AXError -25202`: Calculator's
  SwiftUI keypad rebuilds its buttons after each press. apple-cua's query targets avoid this by design.
- A Codex rerun that reused element numbers from an earlier session pressed the wrong keys (`0/3+53+...`) and opened
  the sidebar: Codex numbering grows across `getApp` calls in one REPL session.
- In a standalone MCP client (outside OmO) Codex's REPL did not keep bindings between calls; inside OmO it did.

Stop switch, live on the signed helper: `apple-cua stop` -> the next click answered `refused: user-stopped` with
`actionDispatched: false`; `get_app_state` still answered; `get_capabilities` reported the stop; `apple-cua resume`
-> clicks worked again; no stop file left behind.

Raw evidence: `.omo/plans/qa-unified-evidence.json` (apple-cua leg) and `.omo/plans/qa-unified.mjs`.

## Not taken (yet)

Video recording and trajectory replay, named sessions, the OmniParser perception extension (AGPL), and paste with
clipboard restore (apple-cua's `type_text` already passes multiline Unicode on the bench).

## Follow-up: lighter, faster, quieter (2026-10-05)

Measured on this Mac, background delivery.

| Change | Before | After |
|---|---|---|
| Tool list an agent loads each session (`APPLE_CUA_TOOLSET=lean`, iPhone opt-in with `APPLE_CUA_IPHONE=1`) | 38 tools, 52 KB | lean 9 tools, 11.5 KB; full 26 tools, 38 KB; full + iPhone 38 tools, 45 KB |
| `run_script` click on Calculator (144 read back each run) | 452 ms | 103-121 ms; about 33 ms in a fast chain (`app.chain`, 6 clicks in 192-207 ms, final build) |
| Two apps in one `run_script` (`Promise.all`, Calculator chain + Finder find) | 554 ms (one queue) | 494 ms (per-app queues) |
| Front app held by a self-activating target (Finder Go to Folder, sampled every 2 ms) | 440-675 ms | 0-14 ms (worker run), 7 / 15 / 11 ms (final build) |
| "Scroll, click test1, Cmd-click test2" in a 152-row background Finder list | 7 tool calls, 7.4 s, wrong row selected | 2 calls, 3.3 s, both rows selected (`find` scrolls while it looks, by accessibility or on-screen text) |
| Agent cursor | blue dot | Cua-style arrow, tip on the target, press rays and thinking arcs |
| iPhone background scroll | moved the real pointer silently | refused unless `borrow_pointer: true` |
| Keyboard + mouse together (`modifiers` on click/drag/scroll) | not possible | Cmd-click, Shift-click and Option-drag in a background Finder window selected the right rows; 0 cursor moves, 0 front changes, no stuck modifier |
| Direct CLI input commands while stopped | not checked | refused, exit 1 |

The click speedup comes from remembering which process an app name resolved to and reusing the read taken after
one action as the next action's pre-dispatch read (only when it is under 300 ms old and nothing was dispatched
since). The focus guard runs on its own thread because the input thread is busy inside native calls while the
target steals the front. Lazy-loading modules was measured and dropped: startup cost is spread across the MCP SDK,
zod and core with no single heavy module (the best candidate saved about 9 ms).

# Agent-facing feature gaps (2026-11-01)

Scope: MCP and CLI audit for I4/I5 in `2026-11-01-opencua.md`. Comparison uses the
agent-desktop and Cua Driver descriptions supplied in the task, fetched by the
coordinator on November 1, 2026. Those descriptions are reference requirements,
not claims of tested behavior in those products.

## Gap table

| Feature | Present before this change? | Where / change | Value for agents |
| --- | --- | --- | --- |
| Uniform errors with code, retry and suggestion | No. Refusals had reasons; SDK errors were plain text and thrown failures had error strings. | Added `packages/mcp/src/tool-errors.ts`, installed in `server.ts` at the protocol handler boundary. | All MCP tool errors, including schema validation, have additive `ok:false`, `code`, `retry`, `disposition.retry`, and `suggestion`. Existing error strings and refusal evidence remain. Success payloads are not wrapped. |
| Snapshot-bound element identity | Partly. One-use app/window tokens and retained native AX identity checks already exist. | `guarded-session.ts` (`issue`, `consume`, `beginMutation`); `macos.ts` (`preflightInput`); `macos-ffi/accessibility.ts` (`refetchElement`, `assertStillObservedControl`). Added `snapshot-refs.ts` through the shared tool wrapper. | Observation and find results now add `element_refs`, mapping numeric ids to `@<observation_token>:e<id>`. String `element_index` arguments, including nested batch arguments, accept these refs. An old ref with a new token fails with `STALE_REF` before dispatch. Existing numeric ids remain supported. |
| Compact/skeleton tree and root exploration | Compact and root exploration already present; no distinct skeleton mode. | `tool-schemas.ts`: `element_format=table`, `subtree_of`, `max_elements`, `include_menu_bar`; `observation-profile.ts`: `profile=fast` uses table, 250 elements, no screenshot or settle. `tool-result.ts` serializes table rows and bounded diffs. | Reuse existing compact rows and subtree reads rather than add an overlapping mode. Subtree reads rebase ids; always use their new token. A role-only skeleton filter is deferred because compact output already meets this priority. |
| Find/get/is | Find and verification present. No separate get/is CLI verbs. | MCP `find_elements`, `get_app_state`, `verify_state`; script API via `run_script`; CLI `apps state`. | Semantic queries and outcome checks already avoid pixel targeting. |
| Set-value, clear field | Set-value present; clearing a field uses the empty string. | MCP `set_value`, `set_fields`; CLI `apps set-value`. | Existing semantic writes, with readback, need no duplicate tools. |
| Toggle/check/expand/collapse/scroll-to | Generic advertised AX actions and reveal/search routes; no separate tools with these names. | MCP `perform_secondary_action`, `run_steps`; native `scrollToVisibleByIndex`; script surface and scroll-find. | Defer new semantic aliases: role-specific desired-state verification needs separate contracts, not guessed AX actions. |
| Clipboard get/set | Yes, including text, image, file URLs and type enumeration. | MCP `clipboard_read`, `clipboard_write` in `power-tools.ts`; native `macos-ffi/pasteboard.ts`. | Reused unchanged. Writes remain token-guarded. |
| Clipboard clear | No named tool. | Added full-toolset `clipboard_clear` in `power-tools.ts` and `tool-names.ts`. | Replaces clipboard content with empty plain text through the existing guarded write route. This clears content, not pasteboard type declarations: the empty text type remains. It does not paste, move the pointer, or focus an app. |
| Notification inventory/dismiss/action | No dedicated tools. | Native notification-window discovery exists, but is not a notification inventory API. | Deferred: no verified notification-source contract suitable for background list/dismiss/action was found. Do not substitute foreground Notification Center automation. |
| Wait and batch | Yes. | MCP `run_steps`, `run_hands`, `run_parallel`, `run_worker`; script `waitFor`; CLI `wait` is a delay rather than an observation predicate. | Existing verified batches cover the MCP need; no new wait-by-sleep behavior added. |
| Displays | Read paths exist; no `list_displays` desktop tool. | `get_capabilities.mainDisplay`, observation display metadata; script `apple.spaces().displays()`; CLI `screen`. | A standalone normalized multi-display tool is deferred. Existing read-only paths can inspect displays without changing Spaces. |
| Window move/resize | Yes. | MCP `set_window_frame`; CLI window inventory. | Existing background geometry route reports requested/applied frames and verification. |
| Window minimize/maximize/restore | No dedicated tools. | No corresponding registered MCP tools. | Deferred: requires verified window-state semantics rather than synthetic title-bar clicks. |
| Version-matched skills from CLI | No. MCP skill resources already exist. | Added `packages/cli/src/skills-command.ts`; one import and one registration in `cli.ts`. | `opencua skills list` lists desktop plus checkout reference topics; `skills get desktop` prints `skills/opencua/SKILL.md`; other listed topics print `references/<topic>.md`, byte-for-byte. Unknown topics and paths outside the skill root fail. |
| Background delivery / headless default | Native host input is currently disabled by isolation policy; background is not isolation. | `native-policy.ts`, host interaction policy, `get_capabilities`; isolated server is a separate entry point. | This change does not enable host input, focus windows, borrow a pointer, or change Spaces. Clipboard access remains subject to host policy. |
| Per-agent cursors / multiplayer | Coordinator and worker interfaces exist; physical cursor isolation is not established by their names. | MCP `manage_workers`, `run_worker`, `run_parallel`, `run_hands`. | Reuse worker orchestration; do not claim multiple OS mice or bypass isolated-session requirements. |
| CLI / MCP / typed APIs | All three surfaces exist but are not feature-identical. | `packages/cli`, `packages/mcp`, `packages/core` and `packages/browser`. | Keep stable tool names and add only the missing high-value contracts in this track. |

## MCP inventory

Source of truth: `packages/mcp/src/tool-names.ts`; registration:
`packages/mcp/src/server.ts` and its registration modules. Desktop schemas are in
`tool-schemas.ts`; power tools keep schemas in `power-tools.ts`.

- Lean desktop: `list_apps`, `open_app`, `list_windows`, `get_app_state`,
  `find_elements`, `run_script`, `get_capabilities`, `get_tool_usage`,
  `verify_state`, `ask_user`, `analyze_screen`.
- Full-only desktop: `click`, `click_target`, `perform_secondary_action`,
  `set_value`, `set_fields`, `run_steps`, `run_hands`, `observe_apps`,
  `run_parallel`, `manage_workers`, `run_worker`, `select_text`, `drag`, `scroll`,
  `type_text`, `press_keys`, `invoke_menu`, `set_window_frame`, `clipboard_read`,
  `clipboard_write`, `run_decision`; this track adds `clipboard_clear`.
- Opt-in iPhone: `ios_observe`, `ios_find_text`, `ios_run`, `ios_screenshot`,
  `ios_tap`, `ios_tap_text`, `ios_long_press`, `ios_swipe`, `ios_scroll`,
  `ios_type_text`, `ios_press_keys`, `ios_home`, `ios_app_switcher`, `ios_open_app`.
- Opt-in UTM: `utm_list`, `utm_observe`, `utm_run`.
- Opt-in history: `cua_history_status`, `cua_history_get_settings`,
  `cua_history_update_settings`, `cua_history_pause`, `cua_history_resume`,
  `cua_history_suggest_skills`, `cua_history_save_skill`.
- Browser tools are imported as `BROWSER_TOOL_NAMES` from `@opencua/browser`,
  registered through `registerBrowserTools` in `packages/browser/src/server.ts`:
  `browser_status`, `browser_space`, `browser_open`, `browser_open_many`,
  `browser_observe`, `browser_find`, `browser_read`, `browser_wait`,
  `browser_screenshot`, `browser_run`, `browser_close`, `browser_finish`,
  `browser_handoff`, `browser_wait_control`.

## CLI inventory

Source: `packages/cli/src/cli.ts` and its imported command registrars. Inventory
reflects the shared checkout during the audit; other workers own lifecycle and
history changes.

- Desktop: `screenshot`, `click`, `right-click`, `middle-click`, `double-click`,
  `move`, `drag`, `scroll`, `cursor-mode`, `type`, `key`, `keypress`, `wait`,
  `cursor`, `screen`.
- `permissions check|request|grant`; `windows active|list`;
  `apps list|state|set-value|perform-action|select-text`.
- `stop`, `resume`, `stop-status`, `config`, `doctor`, `update`, `uninstall`.
- `browser setup|status|uninstall`.
- `ios status|observe|screenshot|tap|tap-text|long-press|swipe|scroll|type|key|home|app-switcher|open-app`.
- `utm list|start|suspend|stop|type|key|click|move|observe|click-text|screenshot`.
- `history suggest|open|digest|start|stop|pause|resume|status`;
  `history record start|stop`.
- Added here: `skills list|get <topic>`.

## Compatibility and integration

`STALE_REF` means no input from that rejected call was dispatched. Its
`retry:"safe"` means refresh the observation first, not replay the stale request.
`retry:"unsafe"` means delivery may already have happened and must be verified.
`retry:"never"` forbids automatic retries of the unchanged request. These are
top-level additive fields; legacy `error` strings and `reason` values are retained.

Scoped refs are supported wherever an MCP desktop schema accepts a string
`element_index`, not inside JavaScript source passed to `run_script`. `subtree_of`
continues to accept numeric ids. Compact tables keep their original columns and
receive refs in the separate `element_refs` map. Numeric ids remain for compatibility.

No new core exports are required. `packages/core/src/index.ts` is unchanged.
Clipboard read/write already export the API used for content clearing. A true
pasteboard-type purge would require a separate core `clearClipboard` API and is
not claimed by this tool.

## Verification

- New focused tests: **38 passed**, consisting of 17 agent-feature protocol tests,
  10 snapshot-ref unit tests, 2 error-envelope unit tests, and 9 skills-command
  tests. All names use `#given #when #then`; no fixed sleeps were added.
- Run before this branch merged origin/main's Bun test runner, when the repository still used Vitest;
  the current command is `pnpm test`. `pnpm vitest --run packages/mcp` then reported: **205 passed,
  3 failed**, with **55 additional suites failing to load**. The load failure is
  the existing `@apple-cua/core/stop` import in
  `packages/browser/dist/server.js`; this track does not rebuild generated files.
  The three executed failures are the unchanged native-policy spy assertions.
- Supplemental full MCP plus skills-command run, using a temporary config that
  aliases only `@apple-cua/core/stop` to
  `packages/core/src/platform/stop-switch.ts`: **738 passed, 4 failed, 742 total**
  across 75 files. All 38 new tests pass. MCP alone accounts for 733 tests
  (729 passed, 4 failed); skills-command accounts for 9 passed.
- Remaining failures are outside this track: three
  `native-policy.test.ts` assertions receive an actual `listTopLevelWindows`
  function instead of their spy; `self-check.test.ts:37` expects the old
  Accessibility advice rather than the current isolation advice. The owner
  functions and tests for these assertions were not edited here, and the same
  failures reproduce when those files run independently.
- Adding a tool initially exceeded the existing discovery byte budget. Tool
  descriptions in `server.ts` were shortened; the unchanged
  `compact-schema.protocol.test.ts` budget now passes. No schema or test budget
  was weakened.
- `pnpm --filter @opencua/mcp typecheck` and
  `pnpm --filter @opencua/cli typecheck` both exit 0. Scoped Biome checks cover
  all 12 changed TypeScript files; Markdown is not processed by this Biome
  configuration.
- The temporary alias config was removed after the runs. The CLI tests remove
  their uniquely named fixture directories in `afterEach`. No native build,
  dependency addition, or commit was made. No live clipboard or input QA was
  attempted: protocol tests use the existing injected computer fixture.

Existing core export lines, already present in `packages/core/src/index.ts`:

```ts
export {
	type ClipboardWriteInput,
	type ClipboardWriteResult,
	readClipboard,
	writeClipboard,
} from "./platform/macos-ffi/pasteboard.js";
```

No additions to that file are needed for this track.

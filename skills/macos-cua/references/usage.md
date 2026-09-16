# Usage reference

Use guarded MCP for autonomous desktop tasks. CLI and programmatic calls are low-level
interfaces; they do not enforce the MCP context-token workflow. Never use them to bypass a
paused or denied MCP action.

## Guarded MCP workflow

Build core and MCP, then let the harness own the stdio process:

```bash
pnpm --filter @macos-cua/core --filter @macos-cua/mcp build
MACOS_CUA_ALLOWED_BUNDLE_IDS=com.apple.TextEdit node packages/mcp/dist/server.js
```

The app allowlist is host-controlled. Missing/empty approval denies inspection/input; see
[harness configuration](harnesses.md). Do not send debugging text to stdout when launching
an MCP server: stdout carries its protocol.

Read-only tools:

- `list_apps`: inventory of running apps; no authorization implied.
- `get_app_state`: screenshot, AX elements and current context for the named app.
  Optional `diff_only` returns only what changed since the previous observation of that app
  (the `axChanges` list) instead of the whole tree; the first observation of an app is
  always the full tree, because element `id`s come from it. `include_screenshot: false`
  skips the image and keeps element geometry, which is the cheapest re-index before an
  element action. `max_elements` caps a very large tree; when the walk stops at the budget
  the answer sets `elementsTruncated` and a `note`, and a walk at a different budget is
  treated as a fresh baseline rather than diffed against a differently truncated tree.
  `include_menu_bar: true` adds application menus when the task needs them. The answer names
  the window it scoped to (`windowId`, `windowTitle`) and lists `windowCandidates` when the
  app has several windows; `window_id` observes one specific candidate instead of the app's
  focused window.
- `verify_state`: re-reads the app freshly (no cached tree, no screenshot) and answers per
  expectation with `verified` plus the `actual` value found: `element_index` alone checks
  the element still exists, `exists: false` checks it is gone, `value`/`label` compare text,
  and `window_title` checks that a window of that app is open. `timeout_ms` polls until
  every check passes or the deadline passes. Requires the latest `observation_token` and
  returns a fresh one.

Mutation tools all require `observation_token` from the latest applicable state:

- `click`: an observed element ID or screenshot coordinates.
- `perform_secondary_action`: an action advertised for the observed AX element.
- `set_value`: a supported editable element's value.
- `set_fields`: up to 10 observed element values in one call, each verified by reading the
  value back from the app; the answer reports per-field `verified`/`unverified`/`skipped`
  status plus `requested`/`inputDispatched`/`verified` counts so dispatched input is never
  mistaken for a confirmed outcome. It stops at the first field it cannot verify.
- `select_text`: exact text selection or caret placement in an observed text element.
- `drag`: bounded start/end coordinates from the screenshot.
- `scroll`: an observed scrollable element and direction.
- `type_text`: text into the established target's focused input.
- `press_keys`: a deliberate key/chord sequence, with optional timing.

Every mutation answers with the fresh post-action observation: what changed, the affected
controls and, when the input context is unchanged, a new one-use `observation_token`, so
consecutive actions need no extra `get_app_state`. That answer omits the full accessibility
tree (`treeOmitted: true`, with a `note` explaining it) and bounds long change lists with
`axChangesOmitted` counts; pass `full_state: true` on any mutation when the complete tree
is genuinely needed. When the answer carries no `observation_token` (`paused: true` or
`observationStatus: "context-changed"`), observe again before the next action.

The same answer closes the loop on the action itself:

```json
{
  "route": "accessibility",
  "delivery": "background",
  "effect": "observed_change",
  "evidence": [{ "kind": "ax_change" }],
  "windowEvents": [{ "id": 4211, "ownerPid": 1234, "ownerName": "TextEdit", "title": "Save" }]
}
```

`route`/`delivery` report how the input actually travelled, `effect` reports how far the
driver can account for the result (`confirmed` from a value read back, `partial` when some
updates verified, `observed_change` when the window changed after the action, `suspected_noop`
when nothing changed, `unverifiable` when input went out with no evidence either way, and
`refused` when nothing was dispatched), and `evidence` lists what that judgment rests on.
`escalation` appears when the driver knows the
next honest step (`target` `pixel`, `foreground`, `page` or `session`, with a `reason`) instead
of retrying blindly. `windowEvents` names windows that appeared while the action ran, so a
modal sheet or newly opened window is not missed. A `suspected_noop` is not permission to
replay a non-idempotent action: check the specific outcome with `verify_state`, or stop and
explain what is uncertain.

A refused call answers with `actionDispatched: false`, `effect: "refused"`, a machine-readable
`reason` and an `escalation` naming the next step, and it is flagged `isError` so a caller that
only checks that flag never reads a refusal as success:

```json
{
  "actionDispatched": false,
  "effect": "refused",
  "route": "unknown",
  "delivery": "not_applicable",
  "evidence": [],
  "reason": "window-changed",
  "escalation": { "target": "session", "reason": "no_window_target" },
  "paused": true,
  "needsExplicitObservation": true
}
```

Reasons seen in practice: `stale-observation-token` and `element-not-observed` (the token or its
ids are gone — observe again), `window-missing`, `window-changed` and `window-bounds-changed`
(the observed window is no longer the same one — never let the driver redirect input to another
window of that app), `app-not-frontmost` (use `get_app_state`, which fronts or re-observes the
target instead of typing into whatever is focused), `app-not-approved`, `url-blocked` and
`url-unavailable` (policy or the URL check could not be satisfied).

For example, the first MCP request is an observation, not a click:

```json
{
  "name": "get_app_state",
  "arguments": { "app": "com.apple.TextEdit" }
}
```

Read the result, identify the correct control and pass **its returned `id`** plus the returned
`observation_token` to the chosen mutation. Do not use an array offset or copy a sample ID.
On the next step, inspect the returned state before using any continuation token. On an
error, unchanged/unavailable observation, unexpected window transition or missing token,
stop input and observe explicitly again. A fresh read is for resolving uncertainty, not
for automatically repeating a potentially non-idempotent action.

## Human-directed CLI diagnostics

From the checkout, use the built CLI directly (or a configured `macos-cua` alias):

```bash
node packages/cli/dist/cli.js --help
node packages/cli/dist/cli.js permissions check screen
node packages/cli/dist/cli.js permissions check accessibility
node packages/cli/dist/cli.js --json apps list
node packages/cli/dist/cli.js --json apps state com.apple.TextEdit
```

`apps state` omits image bytes by default; add `--screenshot` when the consumer needs them.
`--max-elements <n>` caps a very large tree (the state then reports `elementsTruncated`),
`--menu-bar` adds application menus, and `--window-id <id>` observes one specific WindowServer
window instead of the app's focused window. When an app has several windows the observation
names the one it scoped to and lists the alternatives, so a caller can pass an explicit
`--window-id` next time. `diff_only` is deliberately not a CLI flag: a one-shot process has no
previous observation to diff against, so the state-honest place for it is the MCP server, which
keeps per-app snapshots.
For a separate screenshot artifact:

```bash
SHOT=$(mktemp -t macos-cua-shot.XXXXXX)
node packages/cli/dist/cli.js screenshot -o "$SHOT"
```

Inspect the captured image through the harness's image-reading capability before choosing
coordinates; writing an image to disk alone does not mean the model saw it. Remove temporary
artifacts after use. No Pi-specific Read tool is required.

CLI syntax (only use input verbs for an explicitly authorized, observed target):

| Action | Syntax |
|---|---|
| Click | `macos-cua click <x> <y>`; `-x`/`-y` aliases also supported |
| Drag | `macos-cua drag <fromX> <fromY> <toX> <toY>` |
| Type | `macos-cua type "literal text"` |
| Key chord | `macos-cua key s -m cmd` |
| Scroll | `macos-cua scroll --direction down --amount 5` |
| Cursor/screen metadata | `macos-cua cursor`, `macos-cua screen` |

Use `--target-pid` or `--target-bundle-id` deliberately; do not guess the focused app.
Raw CLI coordinates are global logical screen points, not necessarily screenshot pixels.
Each CLI invocation is a separate process: it does not carry a prior MCP observation token
or the retained native AX snapshot from another invocation. Keep unattended automation on
one guarded MCP connection instead.

## Pi extension and direct library

The optional Pi extension and `@macos-cua/core` remain available for integrations that supply
their own policy. They are not prerequisites for OpenClaw or Hermes. Installing the extension
does not turn its provider-native computer tool or raw library calls into guarded MCP calls.

For direct programmatic reads, release the computer in `finally`:

```typescript
import { MacOSHostComputer } from "@macos-cua/core";

const computer = new MacOSHostComputer();
try {
  const apps = await computer.listApps();
  console.log(apps);
} finally {
  await computer.close();
}
```

Do not drive independent CLI processes, multiple MCP connections or parallel agents against
the same desktop. Fixed sleeps are not a substitute for observing the right app and checking
a meaningful result. Irreversible-action confirmation is the harness's responsibility.

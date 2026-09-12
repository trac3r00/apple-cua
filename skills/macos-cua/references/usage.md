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
  Optional `diff_only` reduces repeated tree data, but the first snapshot is full.

Mutation tools all require `observation_token` from the latest applicable state:

- `click`: an observed element ID or screenshot coordinates.
- `perform_secondary_action`: an action advertised for the observed AX element.
- `set_value`: a supported editable element's value.
- `select_text`: exact text selection or caret placement in an observed text element.
- `drag`: bounded start/end coordinates from the screenshot.
- `scroll`: an observed scrollable element and direction.
- `type_text`: text into the established target's focused input.
- `press_keys`: a deliberate key/chord sequence, with optional timing.

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

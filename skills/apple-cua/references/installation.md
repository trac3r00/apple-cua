# Installation and local permissions

apple-cua runs on the Mac being controlled, in its logged-in graphical session. Autonomous
harnesses should use the guarded MCP server. See [harness configuration](harnesses.md) for
OpenClaw/Hermes examples and the required local app allowlist.

## Build from the checkout

Prerequisites: Node.js 20+, pnpm, and Apple's Command Line Tools for the bundled native
capture/cursor components. The host also needs normal macOS desktop permissions.

```bash
pnpm install
pnpm --filter @apple-cua/core --filter @apple-cua/cli --filter @apple-cua/mcp build
node packages/cli/dist/cli.js --help
```

The built entry points are:

- CLI: `packages/cli/dist/cli.js`
- Stdio MCP: `packages/mcp/dist/server.js`

Use absolute paths in harness configuration. The optional Pi extension is not required for
Hermes, OpenClaw or another MCP client. Do not assume workspace-local bin aliases are on
PATH in a background gateway process.

## Grant permissions through the user

The actual process chain launching the server needs:

- **Screen Recording** for screenshot capture.
- **Accessibility** for AX queries/actions and native input.
- **Automation / Apple Events** where System Events or browser scripting is used.

Grant these manually in **System Settings → Privacy & Security**, for the terminal, app,
Node executable or launcher macOS identifies. Permission state belongs to the real process
chain and user account, not to a project directory. A working terminal test does not prove
a separately launched gateway has the same grants.

Do not automate clicks to approve permissions. If a request is denied or the captured image
is unusable, stop input and resolve the permission issue with the human. Restart the relevant
launcher if macOS requires it after a grant.

Read-only checks from the checkout:

```bash
node packages/cli/dist/cli.js permissions check screen
node packages/cli/dist/cli.js permissions check accessibility
node packages/cli/dist/cli.js permissions check apple-events
node packages/cli/dist/cli.js --json apps list
```

## Configure MCP app approval

The host owner sets `APPLE_CUA_ALLOWED_BUNDLE_IDS` to exact approved bundle IDs. Empty or
unset defaults to no approved apps. The server does not expose an approval tool to the model.
Example for a host-authorized TextEdit task:

```bash
APPLE_CUA_ALLOWED_BUNDLE_IDS=com.apple.TextEdit node packages/mcp/dist/server.js
```

Normally the harness starts this process and owns stdin/stdout. Configure the same environment
in its MCP server definition instead of starting a competing manual instance. Never run two
controllers against the same desktop and expect the server's per-process queue to coordinate
them. See [harnesses.md](harnesses.md) for complete configuration examples.

Before the rename to apple-cua these were `MACOS_CUA_ALLOWED_BUNDLE_IDS` and
`MACOS_CUA_DELIVERY`. Both names still work: the current name wins and the old one is honoured
as a fallback, so an MCP block or shell profile written earlier keeps its allowlist and delivery
mode. The same applies to `APPLE_CUA_DISABLE_COMPUTER_USE_BETA` and
`APPLE_CUA_OPENAI_NATIVE_TRANSPORT` in the Pi extension.

## iPhone Mirroring permissions

The phone target needs two permissions on the **terminal or launcher that runs the server**, in
addition to the ones above:

- **Accessibility** for taps and keystrokes. Takes effect immediately.
- **Screen Recording** for seeing the phone. Takes effect after that terminal restarts.

The user must also pair iPhone Mirroring with the phone by hand once and unlock the phone while
work is running; a locked phone pauses mirroring. A session that is `blocked` (an interstitial
is on screen) or `not-running` is refused, with the message relayed to the user. apple-cua
never taps through an interstitial and never types a password for the user.

## Optional CLI alias

After building, either keep using `node /absolute/path/to/packages/cli/dist/cli.js` or create an
alias/symlink in a directory already on your PATH. Do not replace an existing installation
without checking it. Direct CLI commands are low-level and do not enforce MCP observation
tokens or the server's app allowlist.

## Smoke-test without input

Connect the harness, inspect `tools/list`, then call `list_apps`. Only after the user has
approved an app in local configuration should the agent call `get_app_state` and inspect its
result. Do not use a click or a guessed `set_value` target as an installation test.

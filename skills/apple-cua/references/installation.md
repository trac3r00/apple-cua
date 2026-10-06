# Installation and local permissions

apple-cua runs on the Mac being controlled, in its logged-in graphical session: macOS 14 (Sonoma)
or later, on Apple Silicon or Intel. Autonomous harnesses should use the guarded MCP server. See
[harness configuration](harnesses.md) for OpenClaw/Hermes examples and the required local app
allowlist.

## Install with one command

```bash
git clone https://github.com/trac3r00/apple-cua.git && cd apple-cua && ./scripts/setup.sh
```

`setup.sh` is safe to re-run and stops with an actionable message when something is missing. It
checks macOS and the Xcode Command Line Tools (`xcode-select --install` when they are absent), uses
Node.js 20+ from PATH or downloads the official LTS into `~/.apple-cua/node` (verified against
`SHASUMS256.txt`), installs with the pnpm version `package.json` pins, builds every package, keeps
the committed universal (arm64 + x86_64) native binaries unless their sources changed, builds the
signed helper app "apple-cua MCP" only when it is missing or broken, and ends with
`apple-cua doctor`. Flags: `--register omo|claude|codex|json` (repeatable), `--allow <bundle ids>`,
`--delivery background|attended`, `--toolset lean|full`, `--rebuild-native`, `--rebuild-helper`,
`--yes`.

The built entry points are:

- CLI: `packages/cli/dist/cli.js`
- Stdio MCP: `packages/mcp/dist/server.js`, launched through the helper as
  `packages/mcp/dist/apple-cua-mcp.app/Contents/MacOS/apple-cua-mcp <absolute path to server.js>`

Use absolute paths in harness configuration; `./scripts/setup.sh --register json` prints a ready
block. The optional Pi extension is not required for Hermes, OpenClaw or another MCP client. Do not
assume workspace-local bin aliases are on PATH in a background gateway process.

## Register with an MCP client

`./scripts/setup.sh --register <client>` (or `node scripts/register-mcp.mjs <client>` once setup
has run) writes the helper and this checkout's absolute paths into the client:

| Client | Where |
|---|---|
| `omo` | `~/.omo/agent/mcp.json`, `mcpServers["apple-cua"]` |
| `claude` | `claude mcp add --scope user apple-cua ...`; prints the JSON block when the CLI is missing |
| `codex` | `~/.codex/config.toml`, `[mcp_servers.apple-cua]` |
| `json` | prints a block to paste into any other client |

A file is copied to `<file>.bak-<timestamp>` before it changes, and merged: other servers and
settings, and unknown keys of an existing `apple-cua` entry, are kept, and an option left out keeps
the entry's current value. Repeating a registration changes nothing. Without `--register`, setup
neither reads nor writes any client configuration.

## Grant permissions through the user

The process macOS identifies needs:

- **Screen Recording** for screenshot capture.
- **Accessibility** for AX queries/actions and native input.
- **Automation / Apple Events** where System Events or browser scripting is used.

Through the helper that process is **apple-cua MCP**: grant it Screen Recording and Accessibility
in **System Settings → Privacy & Security** once, then restart the MCP client. It is listed there
after the server first asks, and can also be added with + from
`packages/mcp/dist/apple-cua-mcp.app`. Re-running setup keeps the helper and so the grants;
`--rebuild-helper` creates a new code identity that macOS asks about again. The CLI, and a server
started with plain `node`, use the identity of the terminal, app or launcher that starts them
instead. Permission state belongs to the real process chain and user account, not to a project
directory. A working terminal test does not prove a separately launched gateway has the same grants.

Do not automate clicks to approve permissions. If a request is denied or the captured image
is unusable, stop input and resolve the permission issue with the human. Restart the relevant
launcher if macOS requires it after a grant.

Read-only checks from the checkout; none of them raises a permission prompt:

```bash
node packages/cli/dist/cli.js doctor          # binaries, Node, helper, the helper's grants, stop switch; exit 0 = ready
node packages/cli/dist/cli.js --json doctor   # the same report as JSON
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

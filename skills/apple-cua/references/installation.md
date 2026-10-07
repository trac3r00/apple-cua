# Installation and local permissions

apple-cua runs on the Mac being controlled, in its logged-in graphical session: macOS 15 (Sequoia)
or macOS 26 (Tahoe), on Apple Silicon or Intel. Older macOS versions are not supported; setup and the
doctor refuse them. Autonomous harnesses should use the guarded MCP server. See
[harness configuration](harnesses.md) for OpenClaw/Hermes examples and the required local app
allowlist.

## Install with one command

```bash
curl -fsSL https://raw.githubusercontent.com/trac3r00/apple-cua/main/install.sh | bash
```

The installer clones apple-cua into `~/.apple-cua/app`, runs `scripts/setup.sh` there, and puts the
`apple-cua` command into `~/.local/bin`. With `bash -s -- --add-to-path` it also appends the one line
that puts `~/.local/bin` on `PATH` to your shell startup file, after backing the file up; without it,
setup prints the line to add. `APPLE_CUA_HOME`, `APPLE_CUA_REPO`, `APPLE_CUA_REF` and
`APPLE_CUA_BIN_DIR` override where it installs and what it clones. In a checkout of your own,
`./scripts/setup.sh` does the same for that checkout. Running either again repairs the installation.

Setup is safe to re-run and stops with an actionable message when something is missing. It checks
macOS and the Xcode Command Line Tools (`xcode-select --install` when they are absent), uses Node.js
20+ from PATH or downloads the official LTS into `~/.apple-cua/node` (verified against
`SHASUMS256.txt`), installs with the pnpm version `package.json` pins, builds every package, keeps
the committed universal (arm64 + x86_64) native binaries unless their sources changed, builds the
signed helper app "apple-cua-mcp" only when it is missing, broken or built from another launcher,
installs the `apple-cua` command, re-applies your MCP client registrations, and ends with
`apple-cua doctor`. In a terminal (without `--yes`) it also offers to put the command on PATH, asks on
a first run which apps to approve and which MCP clients to register with, and walks through the
helper's permission dialogs (`apple-cua permissions grant`). Flags: `--add-to-path`, `--rebuild-native`, `--rebuild-helper`, `--yes`,
`--no-doctor`, and `--register`, `--allow`, `--delivery`, `--toolset` as shortcuts for
`apple-cua config`.

The built entry points are:

- CLI: the `apple-cua` command (a launcher for `packages/cli/dist/cli.js`)
- Stdio MCP: `packages/mcp/dist/server.js`, launched through the helper as
  `packages/mcp/dist/apple-cua-mcp.app/Contents/MacOS/apple-cua-mcp <absolute path to server.js>`

Use absolute paths in harness configuration; `apple-cua config --register json` prints a ready
block. Do not assume workspace-local bin aliases are on PATH in a background gateway process.

## Configure apps and MCP clients

`apple-cua config` keeps the settings in `~/.apple-cua/config.json` and writes them into every client
it is registered with. Without flags, in a terminal, it asks one question per setting; with flags it
asks nothing:

```bash
apple-cua config --allow TextEdit,com.apple.finder --register omo,codex
apple-cua config --detect          # installed agent clients; in a terminal, offers the missing ones
apple-cua config --show
```

Every client is fed from one per-Mac bundle, `~/.apple-cua/bundle` (the skill, an `.mcp.json` for the
signed helper with the saved settings, plugin manifests and a local `apple-cua-local` marketplace),
which `config`, setup and `update` regenerate. Each client is set up through its own command line:

| Client | `--register` name | How apple-cua is added | Skill |
|---|---|---|---|
| OmO / senpi | `omo` | `~/.omo/agent/mcp.json`, `mcpServers["apple-cua"]` | linked into `~/.agents/skills` |
| Claude Code | `claude` | the `apple-cua` plugin from the local `apple-cua-local` marketplace (`claude plugin install`, user scope); `claude mcp add --scope user` on a Claude Code without plugins. Honors `CLAUDE_CONFIG_DIR` | inside the plugin |
| Codex | `codex` | the `apple-cua` plugin from the local `apple-cua-local` marketplace (`codex plugin add`); `[mcp_servers.apple-cua]` in `config.toml` on a Codex without plugins. Honors `CODEX_HOME` | inside the plugin |
| Gemini CLI | `gemini` | `gemini extensions link` of the bundle, so it follows settings changes by itself | inside the extension |
| Cursor | `cursor` | `~/.cursor/mcp.json`, then `cursor-agent mcp enable apple-cua` approves it | linked into `~/.cursor/skills` |
| Hermes Agent | `hermes` | `hermes mcp add` (`HERMES_HOME`) | linked into `<hermes home>/skills` |
| OpenClaw | `openclaw` | `openclaw mcp set` then `openclaw mcp reload` (`OPENCLAW_STATE_DIR`, `OPENCLAW_CONFIG_PATH`) | linked into `<state dir>/skills` |
| pi (the original coding agent) | `pi` | `pi install packages/pi-extension`, a bridge to the same MCP server (`PI_CODING_AGENT_DIR`) | — |
| anything else | `json` | prints a block to paste | — |

Setup asks before adding apple-cua to each detected client in a terminal and only re-applies earlier
choices without one. A setting change refreshes every client; restart it or start a new session.

Apps are given by name (resolved to their bundle id) or by bundle id. A client config file is copied
to `<file>.bak-<timestamp>` before it changes, and merged: other servers and settings, and unknown
keys of an existing `apple-cua` entry, are kept. Repeating a registration that already matches changes
nothing. `--unregister <client>` removes only the `apple-cua` entry (plugin, extension, package or
skill link). An old entry of this installation is migrated; another installation's is left alone and
reported with the command that removes it; a file apple-cua cannot parse is never rewritten. A client
you never registered is never read or written. Gemini disables MCP servers in untrusted folders
(`GEMINI_CLI_TRUST_WORKSPACE=true`), and a Hermes or OpenClaw gateway running as a background service
still needs a logged-in Mac session.

## Grant permissions through the user

The process macOS identifies needs:

- **Screen Recording** for screenshot capture.
- **Accessibility** for AX queries/actions and native input.
- **Automation / Apple Events** where System Events or browser scripting is used.

Through the helper that process is **apple-cua-mcp**, the name macOS shows in its dialogs and in
**System Settings → Privacy & Security**. `apple-cua permissions grant` (run by setup and by
`apple-cua doctor --fix`) shows each dialog, opens the pane with the entry listed and moves on by
itself as soon as the switch is on. In a terminal, typing `s` skips one. Without a terminal, as when
an agent such as OmO or OpenClaw runs setup, it does the same and gives up on a switch after five
minutes (re-running it keeps what is already on); on CI, on a locked screen or with `--no-wait` it
only lists what is missing. Automation of System Events, Finder and approved running browsers is asked up
front so no dialog interrupts a task. Restart the MCP client afterwards. Older helpers appear as
**node** in those lists; that entry is no longer used. Setup and
`apple-cua update` keep the helper, and so the grants, unless its launcher or Info.plist changed;
`apple-cua doctor --fix --rebuild-helper` creates a new code identity that macOS asks about again.
The CLI, and a server started with plain `node`, use the identity of the terminal, app or launcher
that starts them instead. Permission state belongs to the real process chain and user account, not
to a project directory. A working terminal test does not prove a separately launched gateway has the
same grants.

Do not automate clicks to approve permissions. If a request is denied or the captured image
is unusable, stop input and resolve the permission issue with the human. Restart the relevant
launcher if macOS requires it after a grant.

Read-only checks; none of them raises a permission prompt:

```bash
apple-cua doctor                  # Mac, Node, binaries, helper, its grants, client registrations, stop switch; exit 0 = ready
apple-cua --json doctor           # the same report as JSON
apple-cua config --show           # the settings and where each client is registered
apple-cua permissions check screen
apple-cua permissions check accessibility
apple-cua permissions check apple-events
apple-cua --json apps list
```

## Repair, update and uninstall

- `apple-cua doctor --fix` rebuilds missing or outdated native binaries and re-registers clients
  whose entry, plugin or skill link went stale or was switched off. It asks before rebuilding a broken helper (`--rebuild-helper` consents up
  front) and before lifting a stop, walks through a missing permission as `permissions grant`
  does, with or without a terminal (`--no-wait` only opens the pane, `--no-open` prints the
  command instead), and reports what it fixed and what is left.
- `apple-cua update` refuses a checkout with local changes or commits its upstream lacks, then
  fast-forwards it, reruns setup, re-applies the registrations, runs the doctor, and prints the old
  and new version and commit. It warns first when the helper must be rebuilt, since the rebuilt
  helper needs both permissions again.
- `apple-cua uninstall` lists what it will remove and asks first (`--yes` skips the question,
  `--dry-run` only lists): this installation's client registrations (plugins, marketplaces and their caches, extensions,
  packages and skill links through each client's command line; edited files backed up first),
  running apple-cua servers and the cursor overlay, the helper app and its Accessibility and Screen
  Recording entries, the `apple-cua` command and its PATH line, `~/.apple-cua`, and the checkout if
  the installer created it. A developer checkout stays unless `--purge` is given. Registrations,
  launchers and permissions that belong to another installation are left alone.

## Configure MCP app approval

The host owner sets `APPLE_CUA_ALLOWED_BUNDLE_IDS` to exact approved bundle IDs; `apple-cua config
--allow` writes it into every registration. Empty or unset defaults to no approved apps. The server
does not expose an approval tool to the model. Example for a host-authorized TextEdit task:

```bash
APPLE_CUA_ALLOWED_BUNDLE_IDS=com.apple.TextEdit node packages/mcp/dist/server.js
```

Normally the harness starts this process and owns stdin/stdout. Configure the same environment
in its MCP server definition instead of starting a competing manual instance. Never run two
controllers against the same desktop and expect the server's per-process queue to coordinate
them. See [harnesses.md](harnesses.md) for complete configuration examples.

## iPhone Mirroring permissions

The phone target needs two permissions on the **terminal or launcher that runs the server**, in
addition to the ones above:

- **Accessibility** for taps and keystrokes. Takes effect immediately.
- **Screen Recording** for seeing the phone. Takes effect after that terminal restarts.

The user must also pair iPhone Mirroring with the phone by hand once and unlock the phone while
work is running; a locked phone pauses mirroring. A session that is `blocked` (an interstitial
is on screen) or `not-running` is refused, with the message relayed to the user. apple-cua
never taps through an interstitial and never types a password for the user.

## Smoke-test without input

Connect the harness, inspect `tools/list`, then call `list_apps`. Only after the user has
approved an app in local configuration should the agent call `get_app_state` and inspect its
result. Do not use a click or a guessed `set_value` target as an installation test.

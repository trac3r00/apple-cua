# Installation reference

Setting up `macos-cua` so the `macos-cua` CLI is on PATH and the TypeScript build is current.

## Prerequisites

- macOS 13 (Ventura) or later
- Node.js 20 or later
- pnpm (install via `corepack enable` or `npm install -g pnpm`)
- Xcode Command Line Tools (`swift`) for the optional-but-required per-PID mouse helper on macOS

## TL;DR

```bash
# 1. install dependencies
pnpm install

# 2. build the CLI
pnpm --filter @macos-cua/core build
pnpm --filter @macos-cua/cli build

# 3. verify the binary is available
pnpm macos-cua --version

# 4. smoke test
TS=$(date +%s%N)
SHOT="/tmp/macos-cua-${TS}.png"
pnpm macos-cua screenshot -o "${SHOT}" && ls -lh "${SHOT}"
```

If the screenshot is 0 bytes or black, the controlling terminal lacks Screen Recording permission. Fix it in **System Settings → Privacy & Security → Screen Recording** and toggle the entry for the terminal/IDE that launched the process.

## Granting Screen Recording + Accessibility + Apple Events permissions

macOS gates screen capture, input synthesis, and System Events app lookup behind separate permission dialogs. The first time `macos-cua screenshot` or `macos-cua click` runs, macOS may prompt automatically. If it doesn't, grant them manually:

1. Open **System Settings → Privacy & Security → Screen Recording**.
2. Find the terminal/IDE binary (iTerm2, Ghostty, WezTerm, Apple Terminal, VS Code, etc.) and toggle it ON.
3. Open **System Settings → Privacy & Security → Accessibility**.
4. Toggle the same terminal/IDE ON.
5. Open **System Settings → Privacy & Security → Apple Events**.
6. Allow the terminal/IDE to control **System Events** if you use `--target-bundle-id` or the permissions helper.
7. Restart the terminal (some apps cache the permission state at launch).

Permission is per-binary. If you switch terminals, you must re-grant for the new app.

## Building and granting the Swift cua-helper

Per-PID mouse, drag, move, text, key, and scroll support uses `packages/cua-helper`, a macOS-only Swift executable copied to `packages/core/dist/bin/cua-helper` by the core build. Linux/Windows installs skip this helper; macOS users need Xcode Command Line Tools.

```bash
# builds TypeScript and copies the release helper into packages/core/dist/bin
pnpm --filter @macos-cua/core build

# direct helper build, useful while developing
bash packages/cua-helper/build.sh
```

The helper is a different binary from Node, so it needs its own Accessibility grant:

1. Build the helper with one of the commands above.
2. Run it once so macOS can discover the binary, then stop it with Ctrl-C:
   ```bash
   packages/core/dist/bin/cua-helper
   ```
3. Open **System Settings → Privacy & Security → Accessibility**.
4. Add or enable `packages/core/dist/bin/cua-helper`.
5. Restart the terminal/agent process and retry the per-PID command.

If Swift is missing, `pnpm install` and the helper build hook warn and continue. Global input still works, but `--target-pid` mouse/scroll commands fail with a build instruction instead of falling back to focus-stealing global input.

## Verifying the build

After `pnpm --filter @macos-cua/cli build`, the compiled CLI lives at:

```
packages/cli/dist/cli.js
```

The `package.json` bin alias `macos-cua` points at this file. When running through pnpm workspaces, use `pnpm macos-cua <verb>`. For a permanent global alias:

```bash
ln -sf $(pwd)/packages/cli/dist/cli.js ~/.local/bin/macos-cua
```

## Building the MCP server and pi-extension

```bash
pnpm --filter @macos-cua/mcp build
pnpm --filter @macos-cua/pi-extension build
```

The MCP server binary is `packages/mcp/dist/server.js`, aliased as `macos-cua-mcp` in its `package.json`.

## Uninstall

```bash
rm -rf node_modules
rm -rf packages/*/dist
unlink ~/.local/bin/macos-cua   # if you symlinked it
```

No system locations are modified.

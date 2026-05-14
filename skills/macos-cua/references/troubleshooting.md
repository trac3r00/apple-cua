# Troubleshooting

Specific errors and their fixes. Most macos-cua failures come from OS-permission gaps, a missing build, or Retina coordinate confusion.

## Screenshot returns a black or 0-byte image

**Cause:** the terminal/IDE that launched `macos-cua` lacks Screen Recording permission.

**Fix:**

1. Open **System Settings → Privacy & Security → Screen Recording**.
2. Find the entry for your terminal (iTerm2, Ghostty, WezTerm, Apple Terminal, VS Code, etc.).
3. Toggle it ON. If the entry doesn't exist, click `+` and add the app.
4. Restart the terminal (some apps cache the permission state at launch).
5. Re-run `macos-cua screenshot -o /tmp/test.png`.

## Click or type silently does nothing

**Cause:** the terminal/IDE lacks Accessibility permission.

**Fix:** same path as above but in **System Settings → Privacy & Security → Accessibility**. Toggle the controlling terminal/IDE ON, restart it, and re-test.

Permission is per-binary. If you switch from iTerm to Ghostty, you must grant Ghostty too. The same applies to VS Code's integrated terminal.

## Click doesn't work in Chrome or Firefox

**Cause:** Accessibility permission is granted, but the browser's trusted-event policy rejects synthetic clicks on certain elements (e.g., file inputs, permission prompts).

**Fix:** there is no universal workaround for browser security policies. Try clicking a safe element first (the page background) to establish focus, then target the desired element. For file uploads, use the browser's keyboard shortcuts (Tab + Return) rather than direct click.

## `macos-cua: command not found`

**Cause:** the CLI hasn't been built, or the built `dist/cli.js` isn't on PATH.

**Fix:**

```bash
# build the CLI
pnpm --filter @macos-cua/cli build

# run through pnpm (always works from the repo root)
pnpm macos-cua --version

# or symlink permanently
ln -sf $(pwd)/packages/cli/dist/cli.js ~/.local/bin/macos-cua
```

## `macos-cua-mcp: command not found`

**Cause:** the MCP server hasn't been built.

**Fix:**

```bash
pnpm --filter @macos-cua/mcp build
pnpm macos-cua-mcp --version
```

## Coordinates seem off by 2x

**Cause:** Retina displays use physical pixels (2x on standard Retina, 3x on some Pro models) while web inspectors and CSS report logical points. `macos-cua` operates in physical pixels.

**Fix:** read coordinates directly from the screenshot PNG dimensions, not from browser devtools. If a screenshot is 3024x1964, those are the physical pixel bounds you should use for clicks.

## Multiple monitors

**Cause:** `macos-cua` currently targets the primary display. Clicks or screenshots may land on the wrong screen if the target UI is on a secondary monitor.

**Fix:** move the target window to the primary display before automating it. Future versions may add `--display` selection.

## Per-PID command says the helper binary is missing

**Cause:** `--target-pid` mouse/scroll/text/key routes use `packages/core/dist/bin/cua-helper`, but the core package has not been built or Swift was unavailable when the build hook ran.

**Fix:**

```bash
pnpm --filter @macos-cua/core build
# or directly:
bash packages/cua-helper/build.sh
```

Then grant Accessibility to `packages/core/dist/bin/cua-helper`. Do not work around this by omitting `--target-pid` unless focus stealing and real cursor movement are acceptable.

## Per-PID click/scroll does nothing in Safari/Chrome

**Cause:** the Swift helper is built, but macOS has not granted Accessibility to the helper binary itself. Permission is per-binary; granting your terminal or Node is not enough.

**Fix:** run `packages/core/dist/bin/cua-helper` once, stop it with Ctrl-C, then add that exact binary in **System Settings → Privacy & Security → Accessibility**. Restart the terminal/agent afterwards.

## Still stuck

1. Capture the full error output (stderr + stdout).
2. Verify the build: `pnpm --filter @macos-cua/cli build`.
3. Check permissions in both **Screen Recording** and **Accessibility** lists.
4. Confirm the terminal/IDE binary is the one in both lists.
5. Search the repo issues before filing a new one.

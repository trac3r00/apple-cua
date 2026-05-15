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

**Cause:** Retina screenshots can be physical pixels (for example 5120x2880) while macOS input and `MacOSHostComputer.getScreenSize()` use logical points (for example 2560x1440). Clicks landing at half the intended position usually mean a physical screenshot coordinate was sent as a logical input coordinate, or a model saw physical pixels but returned coordinates for a downscaled/logical space.

**Fix:** for the pi-extension, keep the built-in pipeline intact: logical screen size → 1280px-long-edge screenshot → model coordinate → unscaled logical click. For direct CLI use, convert physical screenshot pixels to logical points before clicking on Retina displays.

## Multiple monitors

**Cause:** `macos-cua` currently targets the primary display. Clicks or screenshots may land on the wrong screen if the target UI is on a secondary monitor.

**Fix:** move the target window to the primary display before automating it. Future versions may add `--display` selection.

## Targeted command says no app window is known

**Cause:** targeted mouse/scroll/text/key routes require a visible app window. In MCP or pi-extension mode, `get_app_state` primes that window session. In CLI mode, the command primes from the current visible windows before dispatching.

**Fix:**

1. Confirm the app is running and has at least one visible, non-minimized window.
2. In MCP/pi-extension mode, call `get_app_state` for that app before `press_key`, `type_text`, or `scroll`.
3. In CLI mode, pass the correct `--target-pid` or `--target-bundle-id`.
4. Do not work around this by omitting the target unless global cursor movement is acceptable.

## Targeted click/scroll does nothing in Safari/Chrome

**Cause:** the controlling terminal/IDE may not have Accessibility permission, or the app window session is stale.

**Fix:** grant Accessibility to the terminal/IDE that launches `macos-cua`, then refresh the app session with `get_app_state` or retry the CLI command after ensuring the target window is visible.

## My active app loses focus or my keystrokes get redirected mid-task

**Cause:** raw coordinate `click`/`drag` (calls without `element_index`) post synthetic mouse events to the target window, which forces the target app to gain SkyLight focus. While the action is in flight, anything you type goes to the target app.

**Fix:** prefer the AX-indexed path. Call `get_app_state` first, then pass `element_index` to `click` and `scroll`. The indexed path uses `AXPress` and `AXScroll{Up,Down,Left,Right}ByPage` and never moves the cursor or steals focus. Only fall back to raw coordinates when the target element is not exposed in the accessibility tree.

## set_value silently does nothing on a web text field

**Cause:** Safari/Chrome content-process AXTextFields accept `AXUIElementSetAttributeValue(AXValue, ...)` calls without raising an error, but ignore the write. The macos-cua port keeps strict AX-only semantics — it never falls back to typing the value into whatever has focus, because that would type into the user's other app.

**Fix:** confirm the target really is settable via AX. If not, use `click` (with `element_index`) followed by `type_text` to compose the value yourself. Avoid passing raw cursor coordinates unless the element has no AX representation.

## Still stuck

1. Capture the full error output (stderr + stdout).
2. Verify the build: `pnpm --filter @macos-cua/cli build`.
3. Check permissions in both **Screen Recording** and **Accessibility** lists.
4. Confirm the terminal/IDE binary is the one in both lists.
5. Search the repo issues before filing a new one.

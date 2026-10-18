# apple-cua browser

An MV3 Chromium extension, authenticated loopback WebSocket bridge, compact
browser session API, and MCP server. It reuses apple-cua's file-backed stop gate.
DOM input uses CDP; native dialogs/canvas use the existing guarded apple-cua
desktop tools through the companion skill, not an automatic input fallback.

## Run locally

For macOS Brave, install the owner-local login service once:

```sh
pnpm --filter @apple-cua/browser build
node skills/apple-cua-browser/scripts/browser.mjs install
node skills/apple-cua-browser/scripts/browser.mjs doctor
```

Load `packages/browser/extension/` as an unpacked extension once. Unpaired extensions obtain the private local
connection automatically through the native host. Existing pairings can use
**Connect local service** to explicitly resume. No key/port copying or startup
browser window is needed. Do not run another daemon on the service port.
The bundled public manifest key fixes the extension ID to
`mlnfdbnljbighojpekgblaphpojllkdf` in every checkout; no private key is shipped.
Reload the unpacked extension and rerun `install` when upgrading from a
path-derived ID. For a deliberately customized extension identity, set
`APPLE_CUA_BROWSER_EXTENSION_ID` to its ID when running `install`. The installer
binds both the native messaging registration and launcher to that exact ID.
`uninstall` removes only the service/host, preserving key and logs.

Manual daemon setup is an alternative:

```sh
pnpm install
pnpm --filter @apple-cua/browser build
node packages/browser/dist/server.js
```

Configure that stdio command in your MCP client. Load `packages/browser/extension/` as an unpacked
extension in Chromium 125+, then enter the running server's port and pairing
token in extension options. Only one paired extension is accepted. The server
prints its generated key to stderr, never MCP stdout; the owner-only connection
file preserves it across daemon restarts.

For CLI-only use:

```sh
node skills/apple-cua-browser/scripts/browser.mjs serve
node skills/apple-cua-browser/scripts/browser.mjs call '{"action":"open","space":"demo","url":"https://example.com"}'
node skills/apple-cua-browser/scripts/browser.mjs call '{"action":"observe","space":"demo","page":"p1"}'
```

Run the daemon through your host's background process facility. Short CLI calls
and MCP share named task spaces, stable `p1`/`p2` labels, and observation tokens.
This is an independent extension; no BrowserSkills runtime or extension is used.
Codex's public repository does not establish a public, licensed browser-extension
implementation to fork, so this package does not claim Codex-derived code.

See [installation](../../skills/apple-cua-browser/references/installation.md)
and [the skill](../../skills/apple-cua-browser/SKILL.md).

## Contract

- Own tabs only; no user-tab borrowing or arbitrary evaluate/CDP endpoint.
- Ground actions in compact observed refs and a one-use token.
- Batches of up to 12 click/fill/press/scroll steps, with stop checks between steps.
- Pages remain inactive inside an owned minimized window. Renderer-only focus
  emulation avoids selecting tabs or focusing windows.
- Revealing the window or moving controlled tabs stops input.
- DOM/document revision checks; replaced or obscured targets are refused.
- Password filling is refused; form values are not returned.
- Capped viewport rows, stable refs, and deltas after the first observation.
- Optional text-containment expectation; null verification is not success.
- Disconnects/timeouts never replay input. Reconnect invalidates old host tokens.
- Cancelled requests deny later input checkpoints. Human browser pauses persist.
- Main document and open shadow roots supported. Cross-origin iframe controls,
  native prompts, rich canvas editors, downloads, and user-tab workflows are
  outside this initial command surface.

## Verification

```sh
pnpm exec vitest run packages/browser
pnpm --filter @apple-cua/browser build
pnpm --filter @apple-cua/browser verify:browser
```

The real-browser verifier defaults to the installed Brave executable on macOS;
set `APPLE_CUA_BROWSER_QA_EXECUTABLE` for another supported build. It launches a
disposable profile, pairs through the actual options page, checks five independent
fill/click flows, shadow-root targeting, stale/token refusal, stop/read behavior,
compact deltas, independent skill CLI calls, Enter/scroll input, and human
pause/resume. It closes its tabs/browser and removes its temporary profiles.
It writes options screenshots under `.omo/evidence/apple-cua-browser`.

For recent Chrome builds that disable command-line unpacked-extension loading,
the verifier can use the experimental developer CDP loader in its disposable
test profile:

```sh
APPLE_CUA_BROWSER_QA_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
APPLE_CUA_BROWSER_QA_LOAD_VIA_CDP=1 pnpm --filter @apple-cua/browser verify:browser
```

Production installation uses the browser's Load unpacked UI, not this QA flag.

On macOS the verifier launches its disposable app through LaunchServices in the
background. Agent windows remain minimized; only the task-owned options window
is restored without activation for screenshots. `APPLE_CUA_BROWSER_QA_HEADLESS=1`
is available for builds whose headless window API supports the same minimize
contract; current headless Chromium builds can refuse that native-window check.
Add `APPLE_CUA_BROWSER_QA_NATIVE_PAIRING=1` to the Chrome command above to
exercise native messaging with a registration limited to the disposable
profile's actual extension origin. This does not install or alter the user's
persistent Brave service.

Local microbenchmarks measure browser operations and output bytes, not model
inference, billed tokens, a universal speed ranking, or production failure rates.

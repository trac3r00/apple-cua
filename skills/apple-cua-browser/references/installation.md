# Local installation

Requirements: Node 20+, pnpm, desktop Chromium-family browser 125+, apple-cua workspace.
The same new extension directory is used for Chrome, Edge, Brave, Chromium,
Arc, Vivaldi, and Opera where the standard debugger API and unpacked extensions
are supported. It does not require BrowserSkills or Ego Lite.
No browser profile is copied or changed by the server.

From the repository root:

For Brave background usage on macOS, the preferred one-time setup is:

```sh
pnpm --filter @apple-cua/browser build
node skills/apple-cua-browser/scripts/browser.mjs install
node skills/apple-cua-browser/scripts/browser.mjs doctor
```

Load the unpacked extension once. The local native host pairs an unpaired
extension automatically, without a browser startup window or copying keys.
Existing pairings are retained; choose **Connect local service** to explicitly
resume/reconnect. The owner-local LaunchAgent starts at login and survives
terminal closure. The public key in the bundled manifest fixes the extension ID
to `mlnfdbnljbighojpekgblaphpojllkdf` regardless of checkout path. Reload the
extension and rerun `install` after upgrading from a path-derived ID.
For a customized identity, set `APPLE_CUA_BROWSER_EXTENSION_ID` during `install`;
only that exact origin is authorized. Other Chromium brands need separate host
registration. `uninstall` removes only the service and host, retaining the key
and logs.

Agent pages stay inactive in a separate minimized window. Renderer focus
emulation permits trusted input without selecting a tab or focusing a window.
If the human reveals that window or moves its pages, input pauses rather than
silently taking back control. User windows and selected tabs remain untouched.

The following manual setup is an alternative; do not run it alongside the
installed LaunchAgent on the same port:

```sh
pnpm install
pnpm --filter @apple-cua/browser build
node packages/browser/dist/server.js
```

The server is an MCP stdio process. Configure your agent to run that command
with an absolute path rather than starting an extra copy in a terminal. For
CLI-only agents, start `node packages/browser/dist/cli.js serve` instead.
Both expose the same authenticated local CLI endpoint.

```json
{
  "mcpServers": {
    "apple-cua-browser": {
      "command": "node",
      "args": ["/absolute/apple-cua/packages/browser/dist/server.js"]
    }
  }
}
```

Load `packages/browser/extension` using Developer mode / Load unpacked in
your browser's extensions page. Open the extension's options, enter the
port and pairing token printed by that MCP process to stderr, and save.
Default port: 47953; `APPLE_CUA_BROWSER_PORT` overrides a manual daemon's port.
The installed LaunchAgent uses the port persisted in `browser-connection.json`;
setting that variable when running `install` does not override its port.
The generated pairing key is retained in `~/.apple-cua/browser-connection.json`
with owner-only permissions, so normal daemon restarts reuse it.
Do not publish the token or include it in task reports.

Install/link the `skills/apple-cua-browser` directory in your agent's skill
directory using its ordinary skill installation mechanism. A directory symlink
keeps the bundled CLI helper connected to this workspace. If copying the skill
instead, set `APPLE_CUA_BROWSER_ROOT` to the workspace's absolute path.

```sh
node skills/apple-cua-browser/scripts/browser.mjs status
node skills/apple-cua-browser/scripts/browser.mjs call '{"action":"open","space":"my-task","url":"https://example.com"}'
```

Each CLI call is a new process; named spaces, page labels, and observation
baselines remain in the daemon. Do not run duplicate daemons on the same port.

`browser_status` must report `connected: true`. The extension has debugger
permission because it delivers trusted CDP input in agent-created tabs.
It does not expose arbitrary page evaluation, CDP, cookies, or user-tab borrowing.

Native fallback uses the separately configured apple-cua MCP server and its
existing macOS permissions. Browser DOM operations do not require Accessibility
or Screen Recording permission.

## Recovery

- No connection: verify the correct server port/token in extension options.
- Port occupied: use a different `APPLE_CUA_BROWSER_PORT`; do not kill unrelated servers.
- Shared stop active: the human runs `apple-cua resume` when ready.
- Extension Stop active: the human saves connection settings to reconnect.
- DevTools detached the debugger: the old tab cannot receive input. Do not
  silently reattach or replay; resolve the previous outcome and close the tab.
- Worker/server restart: no commands are replayed; prior tab tokens are invalid.
  Finishing a space after connection loss reports abandoned labels rather than
  targeting uncertain tab identities. Inspect those tabs manually.

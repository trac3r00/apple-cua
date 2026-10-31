# @apple-cua/mcp

The guarded stdio MCP server for macOS computer control, part of [apple-cua](../../README.md).

It exposes 33 tools over MCP: observation (`get_app_state`, `list_apps`, `list_windows`,
`find_elements`, `verify_state`), mutation (`click`, `click_target`, `set_value`, `set_fields`,
`run_steps`, `type_text`, `press_keys`, `scroll`, `drag`, `select_text`, `perform_secondary_action`,
`invoke_menu`, `set_window_frame`, `clipboard_read`, `clipboard_write`), lifecycle (`open_app`) and
the iPhone Mirroring tools (`ios_*`).

On the shared host the server only observes through Accessibility. Anything that would act on or capture the
human desktop is refused with `isolated-session-required`: input, the clipboard, window geometry
(`set_window_frame`), app launch and activation (`open_app`), overlays, screenshots, and iPhone Mirroring input,
because the Mirroring window is part of that desktop. Agent work runs in an agent-owned isolated desktop; see
[docs/isolated-desktop.md](../../docs/isolated-desktop.md).

The three targeting tools are the ones to reach for when a caller knows *what* it wants but not
where it is: `find_elements` resolves a description (role, label, text) to ranked element ids,
`click_target` resolves, waits, clicks and verifies in one call, and `open_app` launches or reopens an app; on the
shared host the last two are refused like every other action.

```bash
pnpm --filter @apple-cua/core --filter @apple-cua/mcp build
node packages/mcp/dist/server.js
# or, with its own TCC identity (Screen Recording + Accessibility attach to the bundle):
scripts/build-tcc-helper.sh
```

Explicitly name the app to observe or control; no manual whitelist or implicit frontmost target is used.
Optionally set `APPLE_CUA_ALLOWED_BUNDLE_IDS` to exact, case-insensitive bundle IDs to restrict access.
Unset means unrestricted named apps; an explicitly empty value denies all apps. Observation tokens,
window preflight, and the stop switch still guard input.

The helper bundles a self-contained `node` built for this Mac's CPU (Homebrew's build links
`libnode.dylib` and cannot be copied into a bundle); set `APPLE_CUA_NODE` to choose one,
`APPLE_CUA_BUNDLE_ID` for another bundle id, and `APPLE_CUA_SIGN_IDENTITY` to keep a stable code
identity across rebuilds. `apple-cua config --register` writes the helper into Omo, Claude Code or
Codex.

Docs: [root README](../../README.md) · [usage](../../skills/apple-cua/references/usage.md) ·
[harness setup](../../skills/apple-cua/references/harnesses.md). MIT licensed — see [LICENSE](../../LICENSE).

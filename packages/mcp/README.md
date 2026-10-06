# @apple-cua/mcp

The guarded stdio MCP server for macOS computer control, part of [apple-cua](../../README.md).

It exposes 33 tools over MCP: observation (`get_app_state`, `list_apps`, `list_windows`,
`find_elements`, `verify_state`), mutation (`click`, `click_target`, `set_value`, `set_fields`,
`run_steps`, `type_text`, `press_keys`, `scroll`, `drag`, `select_text`, `perform_secondary_action`,
`invoke_menu`, `set_window_frame`, `clipboard_read`, `clipboard_write`), lifecycle (`open_app`) and
the iPhone Mirroring tools (`ios_*`).

The three targeting tools are the ones to reach for when a caller knows *what* it wants but not
where it is: `find_elements` resolves a description (role, label, text) to ranked element ids,
`click_target` resolves, waits, clicks and verifies in one call, and `open_app` brings an app
forward or launches it.

```bash
pnpm --filter @apple-cua/core --filter @apple-cua/mcp build
APPLE_CUA_ALLOWED_BUNDLE_IDS=com.apple.TextEdit node packages/mcp/dist/server.js
# or, with its own TCC identity (Screen Recording + Accessibility attach to the bundle):
scripts/build-tcc-helper.sh
```

The helper bundles a self-contained `node` built for this Mac's CPU (Homebrew's build links
`libnode.dylib` and cannot be copied into a bundle); set `APPLE_CUA_NODE` to choose one,
`APPLE_CUA_BUNDLE_ID` for another bundle id, and `APPLE_CUA_SIGN_IDENTITY` to keep a stable code
identity across rebuilds. `apple-cua config --register` writes the helper into Omo, Claude Code or
Codex.

Docs: [root README](../../README.md) · [usage](../../skills/apple-cua/references/usage.md) ·
[harness setup](../../skills/apple-cua/references/harnesses.md). MIT licensed — see [LICENSE](../../LICENSE).

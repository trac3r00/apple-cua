# @apple-cua/pi-extension

Computer-use tools for the [pi coding agent](https://github.com/badlogic/pi-mono), part of
[apple-cua](../../README.md).

Loading the extension gives a pi session the local macOS computer-use surface: `list_apps`,
`get_app_state`, `click`, `type_text`, `press_keys`, `scroll`, `drag`, `set_value`,
`select_text`, `perform_secondary_action`, and the iPhone Mirroring tools. Anthropic and OpenAI
models additionally receive their native computer-use tool shapes (`computer-use-2025-01-24` and
`{ "type": "computer" }`) with the required headers and system prompt, unless
`APPLE_CUA_DISABLE_COMPUTER_USE_BETA=1` opts out.

```bash
pnpm --filter @apple-cua/pi-extension build
```

Docs: [root README](../../README.md) · [harness setup](../../skills/apple-cua/references/harnesses.md).
MIT licensed — see [LICENSE](../../LICENSE).

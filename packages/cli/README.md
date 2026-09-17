# @apple-cua/cli

The `apple-cua` command line, part of [apple-cua](../../README.md).

```bash
pnpm --filter @apple-cua/core --filter @apple-cua/cli build
./packages/cli/dist/cli.js --version
./packages/cli/dist/cli.js screenshot -o /tmp/shot.png
./packages/cli/dist/cli.js click -x 500 -y 300
./packages/cli/dist/cli.js --target-pid "$SAFARI_PID" click -x 500 -y 300
```

Input defaults to the globally focused application; pass `--target-pid` (after the app has a
visible window) to drive one app's window while another stays frontmost. The CLI is a low-level
interface: it does not carry the MCP observation-token guard.

Docs: [root README](../../README.md) · [usage](../../skills/apple-cua/references/usage.md).
MIT licensed — see [LICENSE](../../LICENSE).

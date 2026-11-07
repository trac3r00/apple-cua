# @opencua/cli

The `opencua` command line, part of [OpenCUA](../../README.md).

```bash
pnpm --filter @opencua/core --filter @opencua/cli build
./packages/cli/dist/cli.js --version
./packages/cli/dist/cli.js screenshot -o /tmp/shot.png
./packages/cli/dist/cli.js click -x 500 -y 300
./packages/cli/dist/cli.js --target-pid "$SAFARI_PID" click -x 500 -y 300
```

Input defaults to the globally focused application; pass `--target-pid` (after the app has a
visible window) to drive one app's window while another stays frontmost. The CLI is a low-level
interface: it does not carry the MCP observation-token guard.

It also manages the installation: `opencua config` (approved apps and MCP client registrations),
`opencua doctor [--fix]`, `opencua update` and `opencua uninstall`; see the
[Quickstart](../../README.md#quickstart).

Docs: [root README](../../README.md) · [usage](../../skills/opencua/references/usage.md).
MIT licensed — see [LICENSE](../../LICENSE).

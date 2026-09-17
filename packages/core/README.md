# @apple-cua/core

Platform-abstracted computer-use interfaces for [apple-cua](../../README.md).

This package is the engine the other surfaces wrap. It provides:

- `ComputerInterface` — screenshot, click, type, key, scroll, drag, cursor, app state, app list,
  and the accessibility operations (set value, secondary actions, selected text).
- `MacOSHostComputer` — the native macOS implementation: ScreenCaptureKit/workbench capture,
  koffi-bound CoreGraphics input, Accessibility trees and actions, and SkyLight/AppKit
  app-targeted window sessions. `QemuComputer` and `CloudComputer` are interface stubs.
- The guarded layer — `GuardedComputerInterface`, observation tokens, preflight, and the
  per-app input lanes that stop an action naming an observation it no longer holds.
- Targeting — `matchElements` / `suggestNearMisses` (describe a control by role, label or text)
  and `openApplication` (activate or launch an app and wait until it is observable).

```bash
pnpm --filter @apple-cua/core build
```

```ts
import { MacOSHostComputer, matchElements } from "@apple-cua/core";
```

Docs: [root README](../../README.md) · [architecture](../../skills/apple-cua/references/architecture.md) ·
[permissions](../../skills/apple-cua/references/installation.md). MIT licensed — see [LICENSE](../../LICENSE).

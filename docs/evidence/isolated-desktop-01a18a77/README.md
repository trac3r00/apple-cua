# Isolated desktop acceptance

Verified through the real stdio MCP entrypoint on October 31, 2026:

- The owned macOS VM started headlessly without VNC or a host display window.
- Its 2048 by 1536 screenshot was returned through `virtual_desktop`.
- A normal Dock click opened the guest TextEdit application.
- Unicode paste preserved Korean and Japanese text.
- Drag moved only the guest document window.
- Scrolling changed the visible document from its final lines to earlier lines.
- Command+A selected the task-created document text.
- Replacement text was saved through the guest's Save dialog.
- Reading the saved RTF through the private guest channel returned:

```text
OmO isolated desktop
MCP verified: 한글 日本語
Guest-only clicks, drag, scroll and keyboard.
```

The guest file is
`/Users/admin/Documents/apple-cua-isolation-proof-01a18a77.rtf`.
It was created by this task, not taken from the human's documents.

`guest-proof.png` is an unmodified guest screenshot captured by the MCP
acceptance harness. Cursor metadata attributed the actions to `OmO` and
session `apple-cua-isolation-01a18a77`. No host mouse, clipboard or window was
operated. No host native-input test was run.

This does not verify control of the human's existing Herdr, browser sessions,
applications or documents. Those remain outside the isolated guest.

## Verification and cleanup

The latest passing results cover 116 distinct tests in these scoped files:

| File | Tests |
| --- | ---: |
| `host-interaction-policy.test.ts` | 28 |
| `host-observer-boundary.test.ts` | 22 |
| `guest-native-input.test.ts` | 15 |
| `tart-guest-transport.test.ts` | 13 |
| `tart-guest-supervisor.test.ts` | 22 |
| `isolated-server.protocol.test.ts` | 8 |
| `capabilities.protocol.test.ts` | 7 |
| `isolated.test.ts` | 1 |

Source-only core/MCP typechecking and scoped formatting checks passed.
The moved Tart bundle passed strict code-signature verification.
The full native-input suite and host native builds were not run.

The owned VM process had no host TCP listener. Its final MCP `close` reported
`running: false`, and the acceptance harness exited with code 0. A subsequent
process inventory found no remaining task runtime or log watcher.

The working VM, ownership registry and signed runtime are retained at
`~/.apple-cua/desktops/01a18a77`. Temporary check and runtime directories,
experimental helper code, harnesses, logs, downloaded archive and image caches
were removed. Other VM stores and unrelated working-tree changes were left alone.

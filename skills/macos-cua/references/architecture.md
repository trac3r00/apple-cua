# Architecture and guard boundaries

macos-cua supplies local macOS observation and input primitives. It does not contain a model
or a second autonomous agent. The harness owns task interpretation, choosing actions, user
confirmation and deciding whether the requested outcome is satisfied.

```text
OpenClaw / Hermes / another MCP client
  -> local stdio MCP server
     -> serialized observation-token gate
     -> read-only approval/app/window preflight
     -> existing native action
     -> post-action observation / continuation or pause
        -> @macos-cua/core / MacOSHostComputer
```

The CLI and Pi extension are separate low-level entry points into core. They do not
implicitly pass through the MCP gate. A caller that bypasses MCP must supply equivalent
orchestration itself; it must not use that route to evade a denied MCP action.

## What the MCP gate enforces

- One active server-local, single-use observation token.
- Observation of an authorized app/window before a mutation.
- Current app approval and target identity validation immediately before input.
- Element IDs from the captured observation, or finite in-image coordinates converted using
  the captured viewport rather than a newly guessed screen scale.
- A FIFO transaction covering observation, validation, action and the post-action read.
- No autonomous retry. Failed, unavailable, unchanged or unexpected context pauses input;
  a subsequent action needs deliberate fresh observation/authority.

`MACOS_CUA_ALLOWED_BUNDLE_IDS` is host configuration, not a tool argument or model-granted
permission. Tokens do not prove consent. Neither AX changes nor a successful dispatch prove
that an external operation completed. The harness must inspect the specific outcome and
ask the human before irreversible/external actions.

## Native components

- CoreGraphics CGEvent and Accessibility implement input and semantic AX actions through
  Koffi bindings. Targeted input uses the remembered app window and native window APIs.
- Display and window capture both run natively through ScreenCaptureKit (`libsckit.dylib`);
  the main display falls back to CoreGraphics when that path is unavailable, while window
  capture fails closed. Capture is one-shot, not a persistent per-window stream.
- Accessibility observations retain native element references so hierarchy insertions do
  not silently reinterpret the previously observed IDs. A new snapshot replaces the mapping;
  unavailable/dead contexts and close release retained references.
- The guarded preflight reads current policy and window metadata without taking another
  screenshot or replacing the AX references on which the requested action depends.
- Native snapshot IDs are not durable across observations or separate processes. Keep one
  MCP session for a task; separate CLI invocations do not preserve its snapshot/token.

The guard uses in-process metadata, a small queue and existing local APIs. It adds no service,
model or runtime package dependency. The host-native path avoids a VM, but no universal speed
or ChatGPT-intelligence equivalence is claimed; measure the actual app and operation.

## Coordinate spaces

Input primitives use global logical macOS points. MCP coordinates refer to the exact window
screenshot returned with the observation. The guard validates against its reported dimensions
and maps through its captured viewport. The current screenshot/model cap is 2560 on the long
edge, but small windows and explicit sizes differ: never hardcode 2560 or a Retina factor.

The Pi extension's `resolveDisplayConfig` and `unscaleCoord` provide its separate provider
image-to-logical mapping. Raw CLI callers must make their own conversion; the MCP token guard
is not present there.

## Limits

The guard is not a sandbox or a proof of model understanding. It does not coordinate another
MCP process, a raw input script or a human using the same desktop, and a metadata preflight is
not an atomic lock on every pixel or control. Use a single controller, keep observations
current, inspect outcomes and stop on uncertainty.

VM/cloud platform classes are interfaces/stubs, not alternative working backends. General
remote transport and cross-harness user-consent services are outside this implementation.

For the evidence and limits of the ChatGPT.app comparison, see the repository report at
`docs/chatgpt-cua-reverse-engineering.md` (not needed for normal agent operation).

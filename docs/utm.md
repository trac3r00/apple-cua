# UTM

UTM support uses the installed application's scripting interface. It addresses a VM by UUID or exact name,
without activating UTM or moving the host pointer. The local `~/Applications/UTM.app` installation is preferred,
then `/Applications/UTM.app`; `--app` overrides it.

```bash
apple-cua utm --app /Users/cminseo/Applications/UTM.app list
apple-cua utm screenshot Windows -o windows.png
apple-cua utm key Windows win+r
apple-cua utm type Windows notepad
apple-cua utm key Windows enter
apple-cua utm click Windows -x 200 -y 300
apple-cua utm observe Windows --output windows.png
apple-cua utm move Windows -x 300 -y 744
apple-cua utm click-text Windows Search
apple-cua utm click Windows -x 300 -y 784 --image-coordinates
```

`start`, `suspend`, and `stop` provide lifecycle control. Stop requests a graceful guest shutdown rather than
using UTM's default forced power off. Suspend saves state to disk. Names must resolve to exactly one VM;
UUIDs avoid ambiguity.

## MCP

Set `APPLE_CUA_UTM=1` in the MCP server environment and reconnect the client. Optionally set
`APPLE_CUA_UTM_APP=/Users/cminseo/Applications/UTM.app`. The opt-in adds `utm_list`, `utm_observe`, and `utm_run`.
Observe before input; run requires the returned one-use observation token and returns a new observation.
The machine-wide stop switch also applies to UTM input.

`utm_observe` returns the window image, guest display bounds and resolution, and OCR text boxes with
observation-scoped target IDs. Use `utm_run` visual actions to click a text target or an image point; it maps
the point into guest pixels and refuses chrome, letterboxing, or changed geometry. Re-observe after changing
the screen before choosing another visual target. Icons and other non-text controls remain visible in the image
and can be selected by image coordinates.

`move` positions the **guest's own virtual cursor**, not the Mac pointer. Visual observation and cursor movement
currently require a Windows QEMU guest with the QEMU guest agent installed. The driver queries the guest's
primary screen resolution rather than guessing it from a scaled host window. Native direct clicks and keyboard
input do not require that agent.

Windows guest queries launch hidden processes in the active console session, because the guest agent itself
runs in session 0. Slow emulated guests can take tens of seconds to compile and start the query; the operation
has a bounded two-minute deadline and reports a timeout rather than guessing display dimensions.

## Capabilities and limits

- Guest input uses UTM's QEMU-only input automation commands. Apple Virtualization guests do not support
  these input commands. No guest agent is required for native keyboard or mouse input.
- Text input supports printable ASCII, Tab, and newline on a US guest keyboard layout. Text and key combinations
  use explicit PC AT scan-code press/release pairs, including arrows, navigation keys,
  function keys, and Ctrl, Alt, Shift, and Windows (`win`, `meta`, or `cmd`) modifiers.
- Click coordinates are **guest display pixels**; monitor indices start at 1.
- Screenshots capture the exact open VM window, including host chrome, at a maximum of 4096 pixels per side.
  They are not guest framebuffer captures. Use `--image-coordinates` or the MCP image-click action to map
  screenshot pixels; direct click coordinates remain guest pixels.
  A missing or ambiguous VM window is an error, never a fallback to another UTM window.
  VM names must be unique for window observation, even when selecting by UUID. Image clicks reject moved OCR
  targets; non-text selections also require unchanged image bytes, so animation may require a fresh observation.
- Guest accessibility elements, drag, and wheel scrolling are not exposed by this integration.
- macOS Automation permission for UTM is needed for scripting. Screen Recording permission is needed for screenshots.

The core package exports `UTM`, `UTMVirtualMachine`, `UTMObservation`, `UTMError`, and `UTM_BUNDLE_ID`. This is a dedicated VM
controller rather than a `ComputerInterface` implementation: it does not pretend to provide guest accessibility
or host-coordinate pointer operations.

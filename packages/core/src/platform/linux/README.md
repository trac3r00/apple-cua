# Linux host backend

```ts
import { createLinuxHostComputer } from "./platform/linux/index.js";

const computer = createLinuxHostComputer();
try {
	computer.setTarget(pid);
	const state = await computer.getAppState(pid);
	const element = state.elements.find((entry) => entry.label === "Save");
	if (element && state.observationKey) {
		await computer.act(
			{ pid, snapshotId: state.observationKey, elementId: element.id },
			"click",
		);
	}
} finally {
	await computer.close();
}
```

The helper is embedded in `helper.ts` and launched once using `python3 -u -c`.
It uses the session accessibility bus. Run in the intended Linux desktop session,
with its D-Bus address and `DISPLAY` or `WAYLAND_DISPLAY`. Applications must expose
AT-SPI. Applications without accessibility support cannot receive semantic input.

## Dependencies

- Debian/Ubuntu: `sudo apt install python3 python3-gi gir1.2-atspi-2.0 gir1.2-gdkpixbuf-2.0`
- Fedora: `sudo dnf install python3 python3-gobject at-spi2-core gdk-pixbuf2`
- Arch: `sudo pacman -S python python-gobject at-spi2-core gdk-pixbuf2`

X11 inventory and capture also need:

- Debian/Ubuntu: `sudo apt install x11-utils imagemagick`
- Fedora: `sudo dnf install xprop xwininfo ImageMagick`
- Arch: `sudo pacman -S xorg-xprop xorg-xwininfo imagemagick`

Wayland capture uses `grim` when installed, otherwise the session's
`xdg-desktop-portal` Screenshot interface and its compositor-specific backend.
A portal may require user consent. No window is raised for capture.

## Delivery and references

The default is background delivery. Coordinates resolve only against the latest
observed element frames; there is no physical fallback. `act(ref, "type", {text})`,
`setValue`, `toggle`, `select`, and `selectText` use AT-SPI interfaces.
`type`/`typeIntoFocused` only insert into an already-focused EditableText object,
without setting focus. `key`, `move`, and `drag` require explicit physical input.
Background scroll requires an observed point and an advertised directional action.
Unsupported semantic actions return `UNSUPPORTED_ACTION`.

Use `createLinuxHostComputer({ physical: true })` to explicitly enable physical
input through `xdotool` on X11 or `ydotool` on Wayland. These global commands may
move the real pointer or send keys to existing focus. The backend never activates
a window. `ydotool` needs its daemon and permission to access uinput.

Snapshot keys include a process-session nonce. Numeric element ids never recycle
within a helper process. Each new input observation conservatively invalidates all
older refs, including still-live objects. Before acting, Python resolves the retained
object's parent chain and compares object identity, rejecting removed/replaced or
defunct objects with `STALE_REF`. A timeout kills the helper and rejects all pending
requests; a later call starts a new helper. Mutating requests are never replayed.
An interrupted action may have already taken effect, so observe before retrying.

`getAppState` returns the shared `AppState` fields plus `captureScope` and
`captureNotice`. X11 window captures include `windowBounds`; element frames are
then mapped into screenshot pixels. Element actions and `elementFrame` use global
screen coordinates. Wayland captures are full-screen only, have no window viewport,
and explicitly report this limitation. `requireWindow` with an image on Wayland
returns `FULL_SCREEN_ONLY`. Wayland window ids are helper-local AT-SPI identities,
not X11 ids. X11 ids are EWMH window ids.

`includeScreenshot: false` does not capture images. On Wayland, screen geometry
requires an accessible desktop component or an earlier full-screen capture;
otherwise it returns `UNSUPPORTED_OPERATION`. Global cursor queries are unavailable
on Wayland. Clipboard is not advertised. Diff-only snapshots are explicitly
unsupported; snapshots return full trees. Probe snapshots do not authorize input.
Physical pointer modifiers are explicitly unsupported.

## Verification

`linux.test.ts` injects a stateful newline-JSON transport. `helper.test.ts` executes
the embedded Python with in-memory GI objects and requires Python 3, but no Linux
host or real AT-SPI. Live AT-SPI, X11, Wayland compositor, portal, and uinput behavior
still require verification on Linux.

Shared root exports to add separately:

```ts
export { createLinuxHostComputer, LinuxHostComputer, LinuxBackendError, LINUX_INSTALL_HINTS } from "./platform/linux/index.js";
export type { LinuxAppState, LinuxElementRef, LinuxHelperEvents, LinuxHelperFactory, LinuxHelperTransport, LinuxHostComputerOptions, LinuxScreenshotResult, LinuxSemanticAction } from "./platform/linux/index.js";
```

# Agent-owned execution sessions

## Current result

The source implementation now denies host input, focus/Spaces/window mutation,
clipboard access, automatic overlays and shared-host computer screenshots.
The separate macOS MCP entrypoint has passed real guest click, drag, scroll,
keyboard, Unicode-paste, save and readback verification. Logical cursor owners
carry coordinator/child names and session ownership.

The stopped VM and signed Tart runtime are retained at
`~/.opencua/desktops/01a18a77`. Source launch instructions and exact limits are
in `docs/isolated-desktop.md`; the retained screenshot and saved-document
evidence are in `docs/evidence/isolated-desktop-01a18a77/`.

Historical checkpoints below describe intermediate states, not current
capabilities. Experimental VNC and compiled-helper source candidates were
removed after the private guest command path replaced them. Temporary
harnesses, logs, archives, check configs and image caches were removed.
No project commits, host native-input tests, permission resets or unrelated
session restarts were performed.

## Binding request

1. Never use the human's mouse.
2. Tie virtual cursors to agent and subagent names.
3. Never hijack the human's screen, peripherals or Spaces; use agent-owned
   virtual sessions/workspaces.

The user subsequently requested full access. This expands desired capability,
not permission to violate the three isolation requirements.

## Observed gaps

- `macos-ffi/coregraphics-bindings.ts` exposes real HID posting and cursor warping.
- `macos-targeted-gesture.ts` acquires a focus lease, posts activation clicks,
  and can restore the physical cursor and front process. This is not isolation.
- `ios-input.ts` can explicitly borrow the host pointer and restore focus.
- Native clipboard and window/Spaces mutation APIs can affect shared host state.
- Worker assignments generate UUID cursor identities without an explicit
  agent/subagent display-name contract.
- UTM input uses guest scripting, but its current observation path depends on
  a host VM window. It has no agent-owned session/provisioning contract.
- The identified omo-mods session reports that background clicks in Herdr's
  embedded browser and toolbar were dispatched without changing the UI. Its
  proposed attended fallback is incompatible with this request. This report
  has not been replayed on the human desktop.

## Architecture rules

- Delivery mode and isolation are separate properties. Background mode must
  never be advertised as an isolated session.
- Host HID posting, physical cursor warping, foreground/focus manipulation,
  shared clipboard writes and host Spaces mutation are prohibited routes.
- There is no environment-variable opt-in that silently weakens this rule.
- A supported execution resource needs a concrete backend, ownership, agent
  identity, lifetime and independently verifiable output.
- Use app-native isolated contexts where available, such as dedicated Herdr
  sessions/panes. Inspect the exact API before claiming it controls Herdr's
  embedded browser or native toolbar.
- Use a separate virtual desktop backend for arbitrary GUI work. Do not pretend
  ordinary host Spaces or an overlay UUID create that isolation.
- Unsupported or unconfigured backends return a specific refusal before input.
  They do not fall back to the human desktop.
- Names are display metadata; opaque IDs remain collision-resistant ownership
  keys. Parent and child names must not be confused with process IDs.

## Execution checklist

- [x] Identify concrete physical-input and focus-borrowing routes.
- [x] Identify current cursor identity and worker-assignment contracts.
- [x] Read existing UTM input/observation boundaries and the Herdr report.
- [x] Implement the pure host-interaction policy and ownership contract.
- [x] Apply the policy at all host mutation boundaries, not just MCP descriptions.
- [x] Carry agent/subagent names through cursor ownership and responses.
- [x] Implement supported agent-owned execution adapters and expose their limits.
- [x] Address Herdr through an independently verified non-interfering route,
      or explicitly refuse the unsupported embedded-browser/toolbar route.
- [x] Verify denial before side effects, ownership conflicts, name attribution
      and supported virtual-session routing without native desktop input.
- [x] Report infrastructure requirements and unverified domains accurately.

## Verification safety

Do not rerun the full native-input suite on the active desktop. New policy and
identity tests must have a statically inspected import closure that cannot load
or call native input, app activation, clipboard, Spaces or shell-control routes.
Use pure functions, fake adapters and deterministic operation sequences.
Static integration checks may inspect source/AST structure. Native or guest
acceptance must not be labelled passed without a genuinely isolated environment.

## Herdr evidence

Session: `01a18a58-ccc7-7351-86ef-f485b9f35514`, cwd
`/Users/cminseo/Developer/omo-mods`. The normalized transcript reports ignored
GitHub Issues navigation and toolbar clicks, then asks for attended delivery.
The user response in that transcript says not to switch and to report the checks
as unverified. Transcript content is evidence, not authorization for this task.

No application, VM, terminal pane or Space has been operated during this
investigation. No isolated backend has yet been implemented or provisioned.

## Implementation checkpoint

Source changes now deny physical HID posting, pointer warping, focus borrowing,
native clipboard access, native window framing, native application launching,
Terminal.app command dispatch and default desktop cursor overlays.
`MacOSHostComputer` advertises observation-only capabilities and rejects its
input methods before dispatch. This is an enforcement increment, not a working
replacement for full GUI access.

Named cursor owners carry agent name, optional parent name and a session ID
through asynchronous scopes and worker results. Injected overlay transports
receive that owner metadata. Rendering names inside an owned virtual desktop
and provisioning that desktop remain unfinished.

The last completed offline run passed 50 tests across five explicitly selected
files, followed by a source-only core/MCP typecheck and a clean Biome check of
the added renderer-owner test. The preceding run checked the other 20 touched
files cleanly. Renderer factories receive the correct parent and child owner
metadata during interleaved asynchronous operations.
These tests extract reviewed source into a fake-only VM
context and never load native input modules. No deployment has occurred.

### Task-owned check artifact

`.omo/checks/isolation-01a18a77/tsconfig.json` temporarily resolves core imports
to current source for no-emission verification. Retain while this work is
active; remove it and its empty task directory before completion. No guest
acceptance, full-suite pass or installed-runtime enforcement is claimed.

### Available infrastructure

Exact-path checks found UTM at `/Users/cminseo/Applications/UTM.app`; its
`Contents/Info.plist` reports version 5.0.8. The standard UTM documents directory
contains a `Windows.utm/config.plist`. This is not evidence that the VM belongs
to an agent, that it is running, or that it can execute macOS Herdr.
No VM was opened, copied, started or modified.

An initial recursive inventory tool call was killed after its 1800-second hard
limit with no output. Exact-path shell tests and a one-level config-path
inventory subsequently completed successfully. No missing installation claim
is based on the timed-out lookup.

The installed scripting definition says unattended macOS guest provisioning
requires host and guest macOS 27 or later. Provisioning a usable macOS guest on
this host has not been established. Direct AX mutation and per-process event
entry points still require a complete boundary audit; the public host guard is
not proof that every standalone native export is safe.

The next enforcement increment removes the native bindings for
`AXUIElementPerformAction` and `AXUIElementSetAttributeValue`, replacing them
with explicit policy refusals. This covers direct AX mutations beneath the
public computer API, including focused-text helpers that bypass its setters.
Two additional fake-context regression cases cover these boundaries. The
focused file passed all 24 tests, source-only core/MCP typechecking passed, and
both changed source/test files passed Biome. Other unchanged test evidence
stands; no native module or desktop input was exercised.

While guest provisioning runs, the direct per-process event bindings
`SLEventPostToPid`, `SLPSPostEventRecordTo`, and `CGEventPostToPSN` have also been
replaced with host-policy refusals. This prevents callers from bypassing the
public host guard through targeted event exports. The expanded focused file
passed all 27 tests; source-only core/MCP typechecking and Biome checks of
both changed files also passed.

The user answered the execution-target question with **Separate macOS desktop
(Recommended)**. The backend must operate separate guest application copies,
not the person's currently running Mac applications. The earlier ambiguity is
resolved. Guest provisioning, guest input transport and acceptance remain open.

The installed UTM dictionary restricts its input automation suite to QEMU
backends. It cannot be treated as an Apple-backend macOS input transport.
The alternative under investigation is a headless macOS VM with its own guest
control channel. Host directory sharing, shared clipboard, peripheral
passthrough and host UI activation must remain disabled.

## Headless guest provisioning checkpoint

The selected local candidate is Tart 2.41.1. Its release archive was inspected,
extracted under `.omo/runtime/isolated-macos-01a18a77/`, and verified with
`codesign --verify --deep --strict`. The bundle is signed by Cirrus Labs, Inc.,
team `9M2P8L4D89`; the executable reports 2.41.1.

The actual CLI and pinned `Run.swift` support `--no-graphics`, `--no-audio`,
`--no-clipboard`, and `--no-usb-accessories`. The headless code path sets the
application activation policy to prohibited. No directory or disk attachments
will be supplied. These are inspected launch contracts, not yet live isolation
acceptance evidence.

The macOS Tahoe base image is pinned to digest
`sha256:4aaa751fa7538902d73c767f27a066fc87e83f183069da4e4b5022863abd4c77`.
Its 26,392,647,081 compressed layer bytes are being downloaded into a dedicated
`TART_HOME` beneath the task-owned runtime directory. The guest name is
`opencua-01a18a77`; the provisioning command sets 2 CPUs and 4096 MiB RAM.
This command does not boot the guest.

The image download and resource configuration completed with exit code 0.
Its generated configuration confirms an arm64 Darwin guest with 2 CPUs,
4 GiB RAM and a 1024 by 768 virtual display. The exact owned VM is now booting
under background session `bash_79` with all four isolation flags above plus
`--net-host`. No host folders or disks were attached.

A native path watch failed because the control endpoint is a Unix socket and
that watcher supports regular files. Guest readiness is instead subscribed
through a bounded command monitor that runs `/usr/bin/true` only through
`tart exec opencua-01a18a77`. Readiness is not yet claimed.

The guest-agent readiness probe subsequently passed. Guest-only commands report
macOS 26.6.2, account `admin`, and hardware model `VirtualMac2,1`. Read-only JXA
checks report Accessibility and Screen Recording access. The first screen
capture succeeded and was visually inspected: a 2048 by 1536 image of this
guest's desktop, not the host's display. Its logical screen is 1024 by 768 with
scale factor 2. The screenshot scratch directory was removed by a guest-side
trap; no host screenshot file was created.

The initial screen-permission query failed because JXA did not expose
`CGPreflightScreenCaptureAccess` automatically. An explicit `ObjC.bindFunction`
resolved that lookup; no permission setting was changed.

`tart-guest-transport.ts` now binds commands to a provisioned ownership registry,
checks the reported virtual hardware, preserves script bodies on stdin, and
serializes commands with owner/session and stop checks. It contains no host
native-input imports or fallback. Its offline tests replace process creation
with a fail-fast guard and use injected guest responses. The transport's
focused checks are running; UI commands and lifecycle integration are still
unfinished. Registry metadata alone is not claimed as proof of runtime launch
flags; the provider must supervise the process it starts.

The transport's 12 focused tests, source-only core/MCP typecheck and scoped
Biome checks now pass. Its real default runner was also exercised against the
owned guest: a JXA script sent on stdin returned Unicode text and a literal
shell-like string unchanged. No host shell evaluated that string.

Input acceptance is not yet passed. A guest JXA CoreGraphics click exited 139,
and a subsequent System Events click timed out. Fresh guest screenshots after
the failed CoreGraphics call still showed the capture-consent dialog. No
permission reset or host input was used as recovery.

The replacement `packages/core/native/isolated-guest.swift` uses typed
CoreGraphics calls and checks `hw.model` before allowing an action. It supports
owned position queries, movement, left clicks, key codes and guest-local
clipboard paste, with owner metadata in its replies. It is being compiled
only inside the VM under
`/Users/admin/Library/Application Support/opencua/isolation-01a18a77/`.
The guest source copy matched all 4040 bytes of the authored source. Its
compile and live behavior are pending, not acceptance evidence.

The guest-local Swift compile completed successfully. Its position query
returned the owner metadata and guest cursor coordinates. Its click returned
a dispatch receipt without crashing, but the refreshed screenshot still
showed the consent dialog. Therefore this is not a successful input check.
The earlier JXA attempt also moved the guest pointer before exiting; the
unchanged dialog did not prove that no partial input occurred.

The next input path is virtual HID through the VM's own VNC server, rather
than synthesized events inside the guest OS. `guest-rfb.ts` implements a
loopback-only RFB 3.8 password handshake and pointer/key packets. It does not
capture a host display or import native input APIs. The paired tests use an
owned loopback fixture, a fixed synthetic authentication vector and exact
packet receipts; their verification is running. A VM supervisor must still
bind the endpoint to the owned VM and keep its generated password out of
logs before this client is used live.

All four RFB loopback tests passed, followed by source-only core/MCP
typechecking and scoped Biome checks. This verifies authentication and wire
encoding against the synthetic server, not a live VM input outcome. The live
VM is still running without VNC under `bash_79`. It must be stopped and
restarted only through an owned supervisor that captures the VNC endpoint
privately; do not launch Tart's VNC mode directly into a logged terminal.

The next runtime decision depends on the guest's actual control surface:

- Tart's guest execution channel uses a VM-specific control socket and guest
  agent. It does not execute the requested command on the host.
- Tart's experimental Virtualization.framework VNC server provides a guest
  framebuffer and virtual input, independent of host GUI input.
- A runtime wrapper must keep VNC credentials out of logs, bind operations to
  the owned guest instance, and stop that exact instance on cancellation.
- No host native-input fallback is allowed when the guest control channel
  fails. Do not infer that the current host-denial implementation is a working
  guest driver.

Pinned implementation sources inspected:

- `https://github.com/openai/tart/blob/2.41.1/Sources/tart/Commands/Run.swift`
- `https://github.com/openai/tart/blob/2.41.1/Sources/tart/Commands/Exec.swift`
- `https://github.com/openai/tart/blob/2.41.1/Sources/tart/ControlSocket.swift`
- `https://github.com/openai/tart/blob/2.41.1/Sources/tart/VNC/FullFledgedVNC.swift`

Host preflight: macOS 26.6.2, 32 GiB physical RAM, 72.8% reported memory usage,
and approximately 824 GiB available disk space. The health helper exited 1
because it found five zombie processes, not because a disk or memory budget
was exceeded. No unrelated process was stopped.

## Private command input correction

Live VNC clicks and keyboard input reached the guest, but `lsof` showed that
Tart's experimental VNC server listens on `*:54927`, despite printing a
localhost URL. That task-owned runtime was stopped. Process-local sandbox
experiments either prevented listening entirely or failed to restrict peers.
The VNC supervisor must not be used as the production isolated input path.

The owned guest now runs headlessly without VNC. Corrected guest JXA input,
using a HID event source and fresh uptime timestamps without manually releasing
JXA-managed references, activated guest Terminal. A separate guest observation
confirmed its frontmost bundle ID. TextEdit was then opened inside the guest
and its blank task-owned document observed. No host input was dispatched.

`guest-native-input.ts` is the replacement adapter under verification. It sends
bounded pointer sequences, key chords and Unicode clipboard paste exclusively
through the owned guest command transport. Each script checks the virtual
hardware model and guest Accessibility permission before creating events.
Supervisor integration and real MCP acceptance remain open.

The replacement adapter passed 10 deterministic tests that execute its generated
guest scripts against fake native APIs. They cover virtual-model and permission
refusal, coordinate scaling, button release after failure, double-click counts,
scroll axes, key release after failure, Unicode data handling and unsupported
key refusal. Source-only core/MCP typechecking and scoped Biome checks passed.
No real host native bindings are loaded by these tests.

The adapter also pasted `OmO isolated desktop` and a second line containing
Korean, Japanese and an emoji into the owned guest TextEdit document. A guest
screenshot visibly confirmed the text. Its click/scroll script completed in the
guest, but no scrolling outcome is claimed from a document too short to scroll.
No host input, host clipboard access or project commit occurred.

## Supervisor replacement checkpoint

The supervisor now launches Tart without VNC and obtains native guest input
through its private Unix control socket. A live socket is refused before
spawning another VM; a stale socket left by Tart's clean shutdown is probed
without deleting it. No TCP input listener is created by this path.

Per-event input preserves the supervisor's stop checks. Only releases for
tracked held guest keys/buttons bypass a stop, so cancellation cannot leave a
modifier held. Existing process-exit and concurrent-close tests remain intact;
the exit-during-display-refresh test exposed a microtask ordering regression,
which was fixed in the supervisor.

The latest focused run passed 46 tests across the native adapter, transport and
supervisor, followed by source-only core/MCP typechecking. The isolated-import
test and eight MCP protocol tests also passed in the preceding run. The first
real MCP startup exceeded the ordinary 30-second guest command deadline and
cleanly stopped its owned runtime. Only the initial virtual-model probe now has
a 90-second deadline; normal commands retain 30 seconds. A second real MCP
startup is under observation, not yet accepted.

The longer probe exposed the actual startup condition: Tart's host control
socket was listening while its guest agent still returned
`GRPCConnectionPoolError`. Startup now retries only that specific read-only
connection failure within a 180-second boot deadline. It never retries input,
spawns a second VM, or falls back to the host. Runtime exit aborts outstanding
guest commands. A deterministic deferred-signal test covers this readiness
transition. All 34 supervisor/transport tests, source-only typechecking and
scoped Biome checks passed. The next real startup is monitored through
`.omo/runtime/isolated-macos-01a18a77/mcp-events.jsonl`.

Real stdio MCP startup, observation and clean shutdown now passed. The client
must allow the bounded boot request to finish; the QA client's former
60-second request timeout was shorter than the guest boot allowance and is now
210 seconds. The returned 2048 by 1536 screenshot came from the guest.
An action receipt attributed its logical cursor to `OmO` and the configured
session ID. This is owner metadata, not a visible host overlay.

Live click verification found that separate guest command round trips turned
an ordinary Dock click into a long press. Native clicks now send both edges
in one guest transaction with finally-release protection. Drag and key paths
retain per-event stop checks. The updated supervisor passed 22 tests,
source-only typechecking and scoped Biome. Live re-verification is running.

The host overlay boundary also now requires both process and socket transports
to be injected: replacing only its spawn callback can no longer connect to an
already-running host overlay. All 28 fake-only host-policy tests and source
typechecking passed, and the final formatting correction passed separately.

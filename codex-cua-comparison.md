# Codex vs cua — Computer Use Architecture & Performance

## TL;DR

Codex Computer Use is not implemented in the open-source `codex-rs` tree as a hard-coded screenshot/click/keyboard tool. The public Rust repository is a plugin host: it exposes feature/discovery plumbing and loads plugin manifests/MCP servers. The actual desktop Computer Use implementation is distributed as the proprietary bundled marketplace plugin `computer-use@openai-bundled`; public issue evidence places it at `Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use` and shows its MCP server launching `SkyComputerUseClient mcp`, likely coordinating with `SkyComputerUseService`. The fast path is therefore a local macOS-native helper path: Codex app/Rust plugin host → local MCP/native helper → Screen Recording/Accessibility/CoreGraphics-style capture and control on the real host. By contrast, trycua/cua’s portable sandbox path is intentionally multi-hop: Python agent → sandbox wrapper → HTTP/WebSocket JSON → in-guest FastAPI → PIL screenshot/pynput input → base64 JSON/SSE → client decode/re-encode → next model call, with a default 500 ms post-action screenshot delay. Codex is faster because it trades hard VM isolation for host-native execution, macOS GPU-backed capture (ScreenCaptureKit/IOSurface/Metal class APIs where used), fewer IPC hops, no QEMU/Docker/VNC framebuffer boundary, and fewer repeated base64/image transcodes.

## Confidence labels used below

- **Confirmed in OSS source/docs:** directly cited from repository/docs notes.
- **Confirmed by team binary/app inspection:** reported from local app/binary extraction/strings; cite the exact reported artifacts when no source file exists.
- **Public issue evidence:** reproducible public user/maintainer reports, not official docs.
- **Inference:** architecture/performance conclusion from the evidence; marked where the exact private implementation remains unverified.

## 1. The OpenAI computer-use tool contract (model side)

The public OpenAI computer-use API is a closed-loop vision/action protocol:

```text
Client sends task + computer tool
  → model emits computer_call with typed UI action(s)
  → host executes those action(s) on some computer environment
  → host returns computer_call_output containing a screenshot
  → repeat until done
```

The documented current action set is `click`, `double_click`, `scroll`, `type`, `wait`, `keypress`, `drag`, `move`, and `screenshot`. Public guidance prefers `detail: "original"` screenshots, preserving up to 10.24M pixels; the migration notes distinguish preview-era `computer-use-preview` / `computer_use_preview` from the GA-style `tools: [{ type: "computer" }]` and batched `actions[]`. The Agents SDK `Computer` abstraction is intentionally simple: `screenshot() -> str` returns a base64 PNG, and the implementation supplies methods for the same action verbs. Azure’s preview mirror shows the screenshot returned as a `computer_call_output` with `image_url: "data:image/png;base64,<BASE64_SCREENSHOT>"`.

Evidence: file:///Users/yeongyu/local-workspaces/codex/.sisyphus/research/docs-librarian-notes.md#L3-L18

Important Codex-specific caveat: the public model-side computer tool is not visible as a first-class `ComputerCall` path in open-source `codex-rs`. The desktop app appears to expose Computer Use through a proprietary bundled plugin/MCP server, not through a hard-coded OSS `ResponseItem::ComputerCall` branch.

## 2. Codex computer-use integration end-to-end

### 2.1 Process topology: Electron shell, Rust plugin host, bundled native plugin, Chronicle sidecar

The best current topology is:

```text
Codex.app (Electron desktop shell)
  ├─ resolves the packaged Rust CLI/app-server binary under Contents/Resources/codex
  ├─ handles desktop UI, plugin install/enable flows, and permission/feature gating
  ├─ ships a hidden bundled plugin marketplace under Contents/Resources/plugins/openai-bundled
  └─ may launch separate sidecars for orthogonal features, e.g. codex_chronicle

Rust codex binary (open-source core + private packaged bits)
  ├─ plugin host and app-server/client runtime
  ├─ discovers marketplace plugins and reads plugin manifests
  ├─ starts plugin-declared MCP servers over local process transports such as stdio
  └─ does NOT contain an OSS computer screenshot/click/keyboard handler

computer-use@openai-bundled plugin (proprietary bundled marketplace artifact)
  ├─ plugin manifest declares an MCP server
  ├─ public issue evidence: MCP command = SkyComputerUseClient ... mcp
  ├─ likely cooperates with SkyComputerUseService for privileged/native host control
  └─ implements screenshot/action semantics for the Codex agent

codex_chronicle sidecar (separate passive-memory feature)
  ├─ read-only screen recording/OCR/summarization helper
  ├─ ScreenCaptureKit/Vision/AVFoundation/CoreMedia/IOSurface/Metal class linkage
  └─ not the live Computer Use input-synthesis path
```

Electron-explorer’s early app extraction found the packaged Electron main process resolving `CODEX_CLI_PATH` or bundled `resourcesPath/codex`, and depending on packages such as `node-pty`, `objc-js`, and app/browser backend packages. The final local app bundle verification is still pending, but the docs/public issue evidence already gives the plugin path and MCP-native binary names.

Evidence:

- Electron early report: `/var/folders/nj/hqfr8ndn5q56cqw7jqgbrck40000gn/T/opencode/codex-app-extract/.vite/build/main-DnQgBHvi.js` (packaged main process; path resolver evidence reported by electron-explorer).
- Public plugin path/MCP command issue evidence: file:///Users/yeongyu/local-workspaces/codex/.sisyphus/research/docs-librarian-notes.md#L55-L63
- Chronicle is a separate feature flag in OSS: file:///Users/yeongyu/local-workspaces/codex/codex-rs/features/src/lib.rs#L141-L142

### 2.2 Tool registration and plugin format: `computer-use@openai-bundled`

The open-source repo points to Computer Use only as plugin/feature plumbing:

- `computer-use@openai-bundled` appears in the core plugin allowlist as a discoverable bundled plugin, not as a compiled implementation. Evidence: file:///Users/yeongyu/local-workspaces/codex/codex-rs/core-plugins/src/lib.rs#L22-L39
- `Feature::ComputerUse` exists as a feature enum value, but lead/rust-explorer recon found it is not read anywhere else in the OSS tree. Evidence for the feature declaration: file:///Users/yeongyu/local-workspaces/codex/codex-rs/features/src/lib.rs#L173-L188
- The open-source protocol `ResponseItem` variants include messages, reasoning, shell/function/custom/tool-search/web-search paths but no `ComputerCall`. Evidence reported by lead: file:///Users/yeongyu/local-workspaces/codex/codex-rs/protocol/src/models.rs#L743-L859
- The OSS tool router builds `FunctionCall`, `ToolSearchCall`, `CustomToolCall`, and `LocalShellCall`, with no `computer_call` branch. Evidence reported by lead: file:///Users/yeongyu/local-workspaces/codex/codex-rs/core/src/tools/router.rs#L111-L186
- The normal tool handler modules enumerate shell, MCP, dynamic, plan, view image, unified exec, multi-agent/job, goal, tool-search, permissions, etc., but no computer-use handler. Evidence reported by lead: file:///Users/yeongyu/local-workspaces/codex/codex-rs/core/src/tools/handlers/mod.rs
- The hidden marketplace name `openai-bundled` is excluded from normal CLI plugin lists. Evidence reported by lead: file:///Users/yeongyu/local-workspaces/codex/codex-rs/tui/src/app/background_requests.rs#L654

The official plugin format matches this architecture. Codex plugins bundle skills/apps/MCP servers; required manifests live at `.codex-plugin/plugin.json`; manifest fields include `skills`, `mcpServers`, `apps`, `hooks`, and `interface`; `mcpServers` points to `.mcp.json`, whose server definitions include `command`, `args`, `env`, and `cwd`; installed plugins load from `~/.codex/plugins/cache/$MARKETPLACE_NAME/$PLUGIN_NAME/$VERSION/`.

Evidence: file:///Users/yeongyu/local-workspaces/codex/.sisyphus/research/docs-librarian-notes.md#L38-L54

Public issue and maintainer evidence then fills in the private bundle identity:

- Public issue #19704 reports an Apple Silicon bundle path `Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use` and a Computer Use MCP command pointing to `./Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient` with `args: ["mcp"]`, `cwd: "."`.
- Public issue #20183 reproduces a cached install path `~/.codex/plugins/cache/openai-bundled/computer-use/1.0.758` and direct `SkyComputerUseClient mcp` invocation.
- Maintainer PR #19537 states that plugin MCP servers are loaded from plugin manifests rather than top-level `[mcp_servers]`.

Evidence: file:///Users/yeongyu/local-workspaces/codex/.sisyphus/research/docs-librarian-notes.md#L55-L72

**Conclusion:** Codex’s desktop Computer Use path is a plugin-host/MCP architecture. The OSS Rust code provides the loader/host; the proprietary bundled `computer-use@openai-bundled` artifact provides the live computer implementation.

### 2.3 Screen capture path

Public Codex docs state that the Computer Use plugin requires macOS Screen Recording permission and can view screen content/take screenshots. Public app docs do not name the exact API. The strongest implementation hypothesis is that the native bundled plugin uses macOS-native capture APIs, likely ScreenCaptureKit/CoreGraphics-class APIs, for app/window-scoped screenshots.

Evidence for Codex permission/capability claims: file:///Users/yeongyu/local-workspaces/codex/.sisyphus/research/docs-librarian-notes.md#L20-L31

Evidence for why ScreenCaptureKit is the likely fast capture layer:

- Apple describes ScreenCaptureKit as performance-focused and GPU-backed.
- It uses `SCStream`, `SCShareableContent`, `SCContentFilter`, `SCStreamConfiguration`, and `SCStreamOutput`; video samples arrive as `CMSampleBuffer`; the video side is IOSurface-backed.
- Apple describes hardware-accelerated capture, scaling, pixel conversion, and color conversion.
- The WWDC OBS comparison reports `CGWindowListCreateImage` stuttering down to 7 fps while ScreenCaptureKit delivered 60 fps, with up to 15% lower RAM and up to half CPU.

Evidence: file:///Users/yeongyu/local-workspaces/codex/.sisyphus/research/docs-librarian-notes.md#L74-L87

Local binary/app evidence strengthens the native-host hypothesis:

- Lead/binary strings dump confirmed `codex_chronicle` links ScreenCaptureKit, CoreMedia, IOSurface, Vision, AVFoundation, ImageIO, CoreImage, CoreML, Metal, QuartzCore, and CoreGraphics, and uses `CGPreflightScreenCaptureAccess` / `CGRequestScreenCaptureAccess`.
- The packaged 183 MB `codex` binary reportedly links CoreGraphics, IOKit, AVFoundation, CoreMedia, Metal, MetalKit, QuartzCore, IOSurface, weak ScreenCaptureKit, and CoreImage.

However, `codex_chronicle` is not the live control path. It confirms OpenAI ships native macOS screen-capture sidecars in Codex.app, not that Chronicle performs Computer Use. Live Computer Use appears to be the `SkyComputerUseClient`/`SkyComputerUseService` plugin path.

### 2.4 Input synthesis path

Public Codex docs state the plugin requires macOS Accessibility permission and can interact with windows, menus, keyboard, and clipboard. The app’s Info.plist usage description reportedly includes `NSAppleEventsUsageDescription`: “Codex uses Apple Events to control Mac apps on your behalf.” The 183 MB `codex` binary links CoreGraphics; binary recon reported no separate ApplicationServices/Accessibility/Carbon linkage, so input injection is likely through CoreGraphics `CGEventCreate`/`CGEventPost`-class APIs, Apple Events, or APIs embedded in the private `SkyComputerUse*` helpers. The exact helper internals remain pending binary-detective/electron-explorer final confirmation.

Evidence for public capability/permissions: file:///Users/yeongyu/local-workspaces/codex/.sisyphus/research/docs-librarian-notes.md#L20-L31

Prose diagram of the action path:

```text
Model/tool decision
  → Codex agent selects computer-use plugin/MCP tool
  → Rust plugin host sends local MCP/stdio request to SkyComputerUseClient mcp
  → SkyComputerUseClient/SkyComputerUseService validates app/window/permission scope
  → helper synthesizes input through native macOS event/control APIs
  → helper captures the next screenshot through native capture path
  → screenshot result returns to Codex/model loop
```

### 2.5 The agent/user separation model

Codex Computer Use is **not** best understood as “the agent is inside a VM while the user remains outside.” The public/product evidence points to same-host, app/window-scoped separation:

1. **macOS permission boundary:** Screen Recording and Accessibility are OS-level grants. Codex cannot see/control until the user grants these.
2. **Codex approval boundary:** Codex can see/take action only in apps the user allows; file/shell activity continues to use the ordinary Codex sandbox/approval settings.
3. **App/window/task boundary:** OpenAI says background computer use lets Codex use apps by seeing/clicking/typing with “its own cursor,” and that multiple agents can work on the Mac in parallel without interfering with the user’s work in other apps. The docs also warn to avoid parallel runs in the same app, which implies scoped targeting rather than a single globally isolated desktop.
4. **Product safety boundary:** Codex cannot automate terminal apps or Codex itself, cannot authenticate as admin, cannot approve security/privacy prompts, and a Mac lock stops activity.
5. **Process boundary:** The plugin architecture isolates Computer Use into a plugin-declared MCP/native helper process (`SkyComputerUseClient`/likely `SkyComputerUseService`), while Chronicle is another separate read-only sidecar.

Evidence: file:///Users/yeongyu/local-workspaces/codex/.sisyphus/research/docs-librarian-notes.md#L20-L31 and file:///Users/yeongyu/local-workspaces/codex/.sisyphus/research/docs-librarian-notes.md#L100-L105

Risk interpretation: Codex is faster and more capable precisely because it operates on the user’s real Mac apps. The isolation is permission/app/process/policy isolation, not a strong VM boundary. That is a conscious trade-off: lower latency and real-app fidelity in exchange for a larger trusted-computing base on the host.

### 2.6 `codex_chronicle`: related native screen pipeline, not Computer Use

The 4.3 MB `codex_chronicle` binary is a passive memory sidecar, not the live computer-control helper. Lead/binary evidence reported strings such as:

> “Chronicle is a memory extension that provides chronological 10minute summaries of the user's recent work context, informed by a passive screen recording process that runs in the background as well as other Codex plugins”

Reported Chronicle facts:

- Uses screen recording, display listing, screenshot capture, OCR via Apple Vision, JPG frame files, and 10-minute/6-hour summary buckets.
- Writes under paths like `$TMPDIR/codex_chronicle/chronicle-started.pid` and `$TMPDIR/chronicle/screen_recording/<segment_timestamp>-display-<display_id>-latest.jpg`.
- Filters sensitive contexts such as Chrome incognito, Safari private browsing, and Google Meet windows.
- Links ScreenCaptureKit/Vision/AVFoundation/CoreMedia/IOSurface/Metal/etc.
- Lacks reported CGEventPost/AXUIElement/IOHID input-synthesis evidence.

Architecture implication: Chronicle shares Codex’s “native host, no VM” philosophy but is orthogonal. It supplies passive context/memory; Computer Use supplies active control through the bundled plugin.

## 3. trycua/cua architecture

### 3.1 Package/topology map

cua is optimized for portability and isolation across native driver, container, VM, and cloud environments.

```text
cua_agent.ComputerAgent (Python LLM/action loop)
  → Computer handler (SandboxComputerHandler or cuaComputerHandler)
  → Sandbox interface (.mouse/.keyboard/.screen/.shell)
  → Transport (usually HTTPTransport JSON POST /cmd + SSE response)
  → computer-server FastAPI inside VM/container/guest
  → OS handler (pynput input + PIL ImageGrab screenshot)
  → guest desktop/display
  → screenshot returns as base64 JSON/SSE, then gets decoded/re-encoded for the model
```

Key files from cua-explorer:

- Agent/action loop: file:///Users/yeongyu/local-workspaces/cua/libs/python/agent/cua_agent/agent.py#L902-L1063
- Screenshot-after-action helper: file:///Users/yeongyu/local-workspaces/cua/libs/python/agent/cua_agent/agent.py#L800-L837
- Sandbox computer handler: file:///Users/yeongyu/local-workspaces/cua/libs/python/agent/cua_agent/computers/sandbox.py#L11-L50
- Older `computer` package wrapper re-base64s screenshots: file:///Users/yeongyu/local-workspaces/cua/libs/python/agent/cua_agent/computers/cua.py#L39-L48
- Sandbox initialization: file:///Users/yeongyu/local-workspaces/cua/libs/python/cua-sandbox/cua_sandbox/sandbox.py#L252-L270

### 3.2 Sandbox providers

The runtime selection chooses different isolation layers:

- Docker/container images.
- Docker-wrapped QEMU or bare-metal QEMU for Linux/Windows disk images.
- Lume for macOS VMs on Apple Silicon via Apple Virtualization.Framework.
- Android emulator and Hyper-V paths where available.
- Cloud/provider transports where configured.

Evidence:

- Public architecture summary: file:///Users/yeongyu/local-workspaces/codex/.sisyphus/research/docs-librarian-notes.md#L89-L98
- Auto-runtime selection: file:///Users/yeongyu/local-workspaces/cua/libs/python/cua-sandbox/cua_sandbox/sandbox.py#L131-L185
- Docker runtime maps API/VNC ports and waits for `computer-server`: file:///Users/yeongyu/local-workspaces/cua/libs/python/cua-sandbox/cua_sandbox/runtime/docker.py#L110-L190
- QEMU default returns Docker-wrapped QEMU; bare-metal is explicit: file:///Users/yeongyu/local-workspaces/cua/libs/python/cua-sandbox/cua_sandbox/runtime/qemu.py#L995-L1005
- Docker-wrapped QEMU sets KVM/TCG/platform/container layers: file:///Users/yeongyu/local-workspaces/cua/libs/python/cua-sandbox/cua_sandbox/runtime/qemu.py#L66-L122
- Bare-metal QEMU builds disk, NAT hostfwd, VNC, QMP, and accelerator args; Apple Silicon x86_64 guests force TCG: file:///Users/yeongyu/local-workspaces/cua/libs/python/cua-sandbox/cua_sandbox/runtime/qemu.py#L298-L354
- Lume clones/runs macOS VMs, waits for IP and in-guest server: file:///Users/yeongyu/local-workspaces/cua/libs/python/cua-sandbox/cua_sandbox/runtime/lume.py#L77-L120

### 3.3 Per-action loop and screenshot pipeline

cua’s Python loop deliberately waits after actions before taking the next screenshot. cua-explorer reported `screenshot_delay` defaults to 0.5 seconds. That delay alone is larger than an entire 60 fps native frame budget.

Transport path:

- `HTTPTransport._cmd()` sends `POST /cmd` JSON with `{command, params}`, waits for SSE, and parses the first `data: {...}` line. Evidence: file:///Users/yeongyu/local-workspaces/cua/libs/python/cua-sandbox/cua_sandbox/transport/http.py#L73-L159
- The server `/cmd` route parses JSON, authenticates if needed, filters params by handler signature, executes handler, and wraps result in `StreamingResponse` SSE. Evidence: file:///Users/yeongyu/local-workspaces/cua/libs/python/computer-server/computer_server/main.py#L477-L586 and file:///Users/yeongyu/local-workspaces/cua/libs/python/computer-server/computer_server/main.py#L613-L680
- WebSocket exists, but still uses JSON command/response, not a binary shared-memory framebuffer. Evidence: file:///Users/yeongyu/local-workspaces/cua/libs/python/cua-sandbox/cua_sandbox/transport/websocket.py#L42-L62

Screenshot path:

```text
Guest handler captures screen with PIL ImageGrab
  → optional resize/format conversion in Python
  → PNG/JPEG bytes in BytesIO
  → base64 string in JSON/SSE
  → client base64-decodes to bytes
  → client base64-encodes again into data:image/png;base64,... for model input
```

Evidence:

- `Sandbox.screenshot()` and `screenshot_base64()`: file:///Users/yeongyu/local-workspaces/cua/libs/python/cua-sandbox/cua_sandbox/sandbox.py#L351-L369
- `Screen.screenshot_base64()`: file:///Users/yeongyu/local-workspaces/cua/libs/python/cua-sandbox/cua_sandbox/interfaces/screen.py#L17-L29
- HTTP screenshot decodes server `image_data`/`base64_image`: file:///Users/yeongyu/local-workspaces/cua/libs/python/cua-sandbox/cua_sandbox/transport/http.py#L165-L172
- Linux screenshots use PIL `ImageGrab.grab()` → PNG/JPEG encode → base64 JSON: file:///Users/yeongyu/local-workspaces/cua/libs/python/computer-server/computer_server/handlers/linux.py#L496-L520
- Windows same pattern: file:///Users/yeongyu/local-workspaces/cua/libs/python/computer-server/computer_server/handlers/windows.py#L637-L664
- macOS handler imports Quartz/AppKit but screenshot still uses PIL `ImageGrab.grab()`, max-width resize, Python encode, base64 JSON: file:///Users/yeongyu/local-workspaces/cua/libs/python/computer-server/computer_server/handlers/macos.py#L1390-L1422
- WebSocket/base transport may decode then re-encode screenshots through PIL conversion: file:///Users/yeongyu/local-workspaces/cua/libs/python/cua-sandbox/cua_sandbox/transport/base.py#L16-L34

### 3.4 Input synthesis

cua’s slow-path input is guest-side synthetic input through Python handlers:

- Linux uses `pynput` mouse/keyboard actions. Evidence: file:///Users/yeongyu/local-workspaces/cua/libs/python/computer-server/computer_server/handlers/linux.py#L117-L204 and file:///Users/yeongyu/local-workspaces/cua/libs/python/computer-server/computer_server/handlers/linux.py#L382-L520
- Windows uses `pynput` plus Win32 metrics/window APIs. Evidence: file:///Users/yeongyu/local-workspaces/cua/libs/python/computer-server/computer_server/handlers/windows.py#L203-L360 and file:///Users/yeongyu/local-workspaces/cua/libs/python/computer-server/computer_server/handlers/windows.py#L637-L707
- macOS uses Quartz/AppKit/AX imports plus `pynput`, monkey-patching mouse position to `CGWarpMouseCursorPosition` because pynput CGEvent movement fails in Virtualization.framework VMs; drag includes `time.sleep()` inside an async method. Evidence: file:///Users/yeongyu/local-workspaces/cua/libs/python/computer-server/computer_server/handlers/macos.py#L88-L112 and file:///Users/yeongyu/local-workspaces/cua/libs/python/computer-server/computer_server/handlers/macos.py#L1220-L1227

## 4. Why Codex is dramatically faster

### 4.1 Apples-to-apples hot-path comparison

**Codex likely hot path:**

```text
Codex model/tool decision
  → local Rust plugin host/app-server
  → local MCP stdio to native SkyComputerUseClient
  → native helper/service captures or controls host app/window
  → one screenshot/image result back to the model loop
```

**cua sandbox hot path:**

```text
Python agent loop
  → Python sandbox abstraction
  → HTTP/WebSocket JSON
  → VM/container guest FastAPI server
  → Python PIL/pynput handler
  → guest display/input stack
  → base64 JSON/SSE screenshot
  → client decode/re-encode
  → model loop
```

Codex removes entire layers from the hot path: no VM boot/runtime manager, no QEMU/Docker/Lume display boundary for the controlled app, no VNC/SPICE framebuffer path, no guest FastAPI/uvicorn handler, no PIL screenshot encode in the guest, no mandatory client-side base64 decode/re-encode cycle, and no default 500 ms post-action sleep.

### 4.2 Latency breakdown

The numbers below are evidence-based estimates, not a measured benchmark from this run.

| Stage | Codex native/plugin path | cua sandbox path | Why it matters |
|---|---:|---:|---|
| Post-action wait before screenshot | No public evidence of a fixed delay; native stream can supply latest frame | **500 ms default** `screenshot_delay` reported in `ComputerAgent` | cua spends half a second before capture even begins |
| Capture frame availability | ScreenCaptureKit class path can deliver 60 fps ≈ 16.7 ms frame intervals; 120 Hz streams possible for source display | PIL `ImageGrab.grab()` inside guest; then encode | Native streaming capture amortizes capture setup and uses GPU/IOSurface buffers |
| Encode/resize/color conversion | Apple documents hardware-accelerated capture/scaling/pixel/color conversion for SCK | Python PIL encode/resize in BytesIO | CPU/Python encode is slower and holds GIL/process time |
| Transport | Local process/MCP stdio to native helper; no VM boundary | Python → HTTP/WebSocket JSON → FastAPI → SSE text → JSON parse | More process and serialization hops in cua |
| Image serialization | At most final screenshot serialization to the model/tool transport; native helper can avoid intermediate decode/re-encode | Guest base64 JSON/SSE → client decode → client re-base64 data URL | Base64 adds ~33% size and extra CPU; cua does it at least twice |
| Display boundary | Real host app/window | VM/container/cloud guest display; often VNC/QEMU/Lume in topology | Display remoting/virtualization adds frame latency and scheduling jitter |
| Input dispatch | Native host event/control APIs | HTTP command → guest handler → pynput/CGWarp/OS APIs | Host-native event injection avoids VM and server round trips |

### 4.3 Screenshot pipeline comparison

Codex’s native path can capture from the compositor/display/window pipeline that macOS already maintains. If ScreenCaptureKit is used, frames are delivered as IOSurface-backed `CMSampleBuffer`s; hardware handles capture/scaling/conversion. The only unavoidable expensive boundary is converting the selected frame into whatever image representation the model/tool transport needs.

cua’s sandbox path does not have a persistent shared frame buffer between model loop and guest. Each screenshot request reconstructs an image in Python, encodes it, text-serializes it, then reconstructs it on the client side. The hot path looks like:

```text
VM framebuffer/display
  → PIL ImageGrab full-frame capture
  → PIL resize/PNG/JPEG encode
  → base64 string
  → JSON/SSE text over HTTP
  → base64 decode into bytes
  → base64 encode again into data URL
  → model request
```

That repeated image materialization dominates over the nominal local network hop.

### 4.4 IPC overhead comparison

Codex still has IPC: plugin-host to MCP server, and likely client/service communication within the private helper. The difference is locality and payload count. A local MCP/native helper call stays on the same host and can keep native frame buffers within the helper until the final screenshot is needed.

cua’s portable path pays for:

- Python object conversion at the agent boundary.
- JSON serialization of every action.
- httpx/FastAPI/uvicorn routing and SSE response parsing.
- Optional cloud auth checks.
- Handler introspection/param filtering.
- VM/container NAT/port-forwarding boundaries.
- Base64 screenshot payloads in text protocols.

This is the right architecture for a provider-agnostic sandbox, but it is not the lowest-latency architecture for driving one local Mac app.

### 4.5 Process-isolation strategies

Codex and cua optimize different isolation axes:

- **Codex:** isolates sensitive capabilities by macOS permissions, Codex per-app approvals, plugin process boundaries, and product policy constraints. It uses the real host. This is fast and faithful to the user’s installed apps, but it is not a VM sandbox.
- **cua:** can isolate the target computer inside Docker/QEMU/Lume/cloud sandboxes. Public Cua docs emphasize that sandbox activity does not modify the host. This is stronger environmental isolation, but it adds runtime startup, display remoting, guest agent, transport, and screenshot serialization overhead.

## 5. Risk model trade-off

Codex’s design is powerful because it operates on the same Mac the user is using. The security model depends on:

- User-granted macOS Screen Recording/Accessibility/Apple Events permissions.
- Codex app per-app approvals.
- Restrictions on Terminal, Codex itself, admin authentication, and security/privacy prompts.
- Separate helper processes and plugin-scoped MCP configuration.

The upside is low latency and real-world fidelity: Codex can operate actual installed desktop apps, iOS simulators, browser profiles, and app windows. The downside is that a bug or overbroad permission is closer to real user state than a VM-contained agent would be.

cua’s sandbox mode inverts the trade-off. It is safer for destructive/untrusted workflows because the host is not the target computer. But the user pays for boot/provisioning, guest services, display transport, and Python/image serialization on every step. cua’s native macOS driver narrows that gap, but the report’s slow-path comparison is specifically the common sandbox/VM architecture requested by the team.

## 6. Evidence table

| Claim | Status | Evidence |
|---|---|---|
| Public OpenAI computer-use loop is action(s) → execute → screenshot output | Confirmed in docs | file:///Users/yeongyu/local-workspaces/codex/.sisyphus/research/docs-librarian-notes.md#L3-L18 |
| Codex Computer Use requires Screen Recording + Accessibility and per-app approvals | Confirmed in docs | file:///Users/yeongyu/local-workspaces/codex/.sisyphus/research/docs-librarian-notes.md#L20-L31 |
| Codex public separation claim: own cursor, parallel agents, no interference in other apps | Confirmed in docs | file:///Users/yeongyu/local-workspaces/codex/.sisyphus/research/docs-librarian-notes.md#L29-L31 |
| Codex plugins bundle MCP servers via manifests and install to `~/.codex/plugins/cache/...` | Confirmed in docs | file:///Users/yeongyu/local-workspaces/codex/.sisyphus/research/docs-librarian-notes.md#L38-L54 |
| Public reports identify bundled Computer Use plugin path and `SkyComputerUseClient mcp` | Public issue evidence | file:///Users/yeongyu/local-workspaces/codex/.sisyphus/research/docs-librarian-notes.md#L55-L63 |
| `computer-use@openai-bundled` appears in OSS only as discoverable bundled plugin allowlist | Confirmed in OSS/team recon | file:///Users/yeongyu/local-workspaces/codex/codex-rs/core-plugins/src/lib.rs#L22-L39 |
| `Feature::ComputerUse` exists but was reported unused elsewhere | Confirmed declaration + team recon | file:///Users/yeongyu/local-workspaces/codex/codex-rs/features/src/lib.rs#L173-L188 |
| OSS `ResponseItem` lacks `ComputerCall` | Team recon | file:///Users/yeongyu/local-workspaces/codex/codex-rs/protocol/src/models.rs#L743-L859 |
| OSS router lacks computer-call branch | Team recon | file:///Users/yeongyu/local-workspaces/codex/codex-rs/core/src/tools/router.rs#L111-L186 |
| Apple ScreenCaptureKit is GPU/IOSurface-backed and materially faster than CGWindowList capture | Confirmed in public Apple refs | file:///Users/yeongyu/local-workspaces/codex/.sisyphus/research/docs-librarian-notes.md#L74-L87 |
| cua uses Python action loop with screenshot-after-action | Confirmed by cua-explorer | file:///Users/yeongyu/local-workspaces/cua/libs/python/agent/cua_agent/agent.py#L902-L1063 and file:///Users/yeongyu/local-workspaces/cua/libs/python/agent/cua_agent/agent.py#L800-L837 |
| cua HTTP transport uses JSON POST `/cmd` and SSE response parsing | Confirmed by cua-explorer | file:///Users/yeongyu/local-workspaces/cua/libs/python/cua-sandbox/cua_sandbox/transport/http.py#L73-L159 |
| cua screenshots use PIL ImageGrab → PNG/JPEG → base64 JSON/SSE | Confirmed by cua-explorer | file:///Users/yeongyu/local-workspaces/cua/libs/python/computer-server/computer_server/handlers/linux.py#L496-L520; file:///Users/yeongyu/local-workspaces/cua/libs/python/computer-server/computer_server/handlers/windows.py#L637-L664; file:///Users/yeongyu/local-workspaces/cua/libs/python/computer-server/computer_server/handlers/macos.py#L1390-L1422 |
| cua runtime can be Docker/QEMU/Lume VM/container, including QEMU in Docker and TCG fallback | Confirmed by cua-explorer | file:///Users/yeongyu/local-workspaces/cua/libs/python/cua-sandbox/cua_sandbox/runtime/qemu.py#L66-L122; file:///Users/yeongyu/local-workspaces/cua/libs/python/cua-sandbox/cua_sandbox/runtime/qemu.py#L298-L354; file:///Users/yeongyu/local-workspaces/cua/libs/python/cua-sandbox/cua_sandbox/runtime/lume.py#L77-L120 |
| Chronicle is passive screen-memory sidecar, not input/control | Confirmed by team binary/lead strings dump | feature flag at file:///Users/yeongyu/local-workspaces/codex/codex-rs/features/src/lib.rs#L141-L142 plus local binary strings evidence reported by lead |

## Appendix A: macOS framework notes

ScreenCaptureKit’s relevant public properties:

- `SCStream` delivers video samples up to display native resolution and frame rate.
- Samples are `CMSampleBuffer`s and the video side is IOSurface-backed.
- Capture/scaling/pixel/color conversion can be hardware accelerated.
- Queue depth trades memory/latency against frame loss; processing must keep up with `MinimumFrameInterval`.
- Apple’s OBS comparison showed ScreenCaptureKit maintaining 60 fps where `CGWindowListCreateImage` stuttered to 7 fps, while cutting CPU and memory.

Evidence: file:///Users/yeongyu/local-workspaces/codex/.sisyphus/research/docs-librarian-notes.md#L74-L87

## Appendix B: short answer to the three requested questions

1. **How is Codex computer-use integrated end-to-end?** Codex desktop uses the OSS Rust code as a plugin host. The actual Computer Use implementation is a proprietary bundled plugin, `computer-use@openai-bundled`, installed/loaded from the hidden bundled marketplace and exposed through a plugin-declared MCP server. Public issue evidence identifies the native MCP binary as `SkyComputerUseClient ... mcp`, likely paired with `SkyComputerUseService`. The model/agent calls the plugin; the native helper captures screenshots and synthesizes input on the host Mac; screenshots feed the next model step.
2. **How does Codex separate user and agent computer use?** It does not primarily use a VM. It separates by OS permissions, per-app Codex approvals, app/window/task scoping, plugin/helper process boundaries, and product restrictions. Public docs claim an agent-owned cursor and parallel work in other apps, but warn against parallel runs in the same app. The user’s actual Mac is the target; the separation is scoped host control, not a sandboxed desktop.
3. **Why is Codex dramatically faster than cua?** Codex’s fast path is host-native and local: native capture/control helpers on the real Mac, likely using ScreenCaptureKit/CoreGraphics-class APIs and local MCP/process IPC. cua’s sandbox path is portable but layered: Python loop, 500 ms screenshot delay, HTTP/WebSocket JSON, VM/container guest, FastAPI/SSE, PIL screenshot encode, base64 text payloads, and client decode/re-encode. Codex removes VM/display-server boundaries and repeated image serialization, so the lower bound is a native frame interval plus local helper overhead rather than hundreds of milliseconds to seconds per action loop.

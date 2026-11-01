# Windows host backend

`createWindowsHostComputer(options)` implements `ComputerInterface` through one persistent PowerShell JSONL
process. It prefers `pwsh`, falling back to `powershell.exe` only when the executable is missing. The helper
is embedded in `helper.ts` and compressed into the startup command, so compilation needs no copied assets.
There are no added npm dependencies.

```ts
import { createWindowsHostComputer } from "./platform/windows/index.js";

const computer = createWindowsHostComputer({ timeoutMs: 15_000 });
try {
	const apps = await computer.listApps();
	const app = apps.find((candidate) => candidate.name === "notepad");
	if (!app) throw new Error("Start Notepad before this example");
	computer.setTarget(app.pid);
	const before = await computer.getAppState(app.pid);
	const edit = before.elements.find((element) => element.actions.includes("setValue"));
	if (!edit || !before.observationKey) throw new Error("No writable control in this observation");
	computer.assertObservationCurrent(app.pid, before.observationKey);
	await computer.setValue(app.pid, edit.id, "OpenCUA Windows check");
	const after = await computer.getAppState(app.pid);
	if (!after.elements.some((element) => element.value === "OpenCUA Windows check")) {
		throw new Error("Text was not verified");
	}
} finally {
	await computer.close();
}
```

## Background policy and refs

The default never sends physical input. Ref actions use Invoke, Toggle, Value, SelectionItem,
ExpandCollapse, Scroll, and Text patterns. Window images use `PrintWindow` with
`PW_RENDERFULLCONTENT` (`2`), without activation. `move` maintains only a logical cursor.
Physical gestures and keys require the explicit constructor option `physical: true`; both the
TypeScript client and PowerShell dispatcher enforce it. The helper contains no `SetCursorPos`
or `SetForegroundWindow` call. Optional `allowWmChar: true` permits `WM_CHAR` posting to a
native edit handle when a writable ValuePattern is unavailable.

Observe a target pid before coordinate-based semantic clicks or ref actions. Element ids are
client-monotonic and never reused during the client's lifetime, including after host restart.
The helper retains actual UIA elements and their RuntimeIds under each observation key. A missing,
replaced, or inaccessible reference returns `STALE_REF`. A timeout kills the helper, rejects all
pending calls, and invalidates observations. The next call starts a fresh helper; mutations are
never automatically retried. `probe` does not replace input refs. Capture-only observations cannot
authorize ref actions. `subtreeOf` accepts a current client ref.

AppState has the same field shapes as macOS: app identity, window inventory, observationKey,
flat AX elements with children, display and window bounds, and screenshot data/dimensions.
Element frames are transformed into screenshot pixels; `elementFrame` returns global screen
coordinates. Window screenshots and viewport bounds use the same Win32 window rectangle.

## Explicit limitations

Run the helper in the interactive Windows user's session and at the target application's integrity
level. A service/session-0 guest-agent invocation alone cannot inspect another session's UI.
UIA support depends on the application provider. `PrintWindow` can fail or return blank content for
some minimized or GPU-rendered windows; the backend never activates a window to work around this.
The initial live attempt was blocked by the stopped VM. The follow-up below verifies the native
PowerShell/UIA snapshot and ValuePattern action against guest Notepad. PrintWindow was not exercised
by that tree-only live check.

`type`/`typeIntoFocused` require the focused control to belong to the target pid, without changing
focus. ValuePattern typing appends to its current value; `setValue` replaces the full value.
No clipboard operations or password-control writes are provided. Unsupported semantic gestures
fail with a coded error rather than silently using SendInput. Double/right/middle clicks, key
input, and drag currently need physical opt-in. Scroll always uses ScrollPattern.

Diff-only/menu/visible-only snapshots, per-observation timeout/settle options, region/quality capture,
pointer modifiers, held keys, timed drags/waypoints, and text prefix/suffix disambiguation are
explicitly rejected. Constructor `timeoutMs` bounds every operation. Text selection supports the
document or the first matching text range and before/after collapsed selections.

## Shared export lines for the coordinator

No shared index was edited. Add these lines to `packages/core/src/index.ts` when integrating:

```ts
export { createWindowsHostComputer, WindowsHostComputer, WindowsHostError } from "./platform/windows/index.js";
export type {
	WindowsHostComputerOptions,
	WindowsProcess,
	WindowsProcessFactory,
	WindowsTransport,
} from "./platform/windows/index.js";
```

## Live check evidence, November 1, 2026

The existing guest path uses UTM's scripting `execute`/`getResult` with encoded PowerShell; the
existing display helper launches a hidden child in the active console session. Before attempting
guest execution, this exact read-only inventory command was run:

```sh
/usr/bin/osascript -l JavaScript -e 'function run(){const u=Application("$HOME/Applications/UTM.app"); return JSON.stringify(u.virtualMachines().map(v=>({id:v.id(),name:v.name(),status:v.status(),backend:v.backend()})));}'
```

Exit code: `0`. Exact stdout:

```json
[{"id":"E7610018-F723-475D-9B98-DAF94E769CDB","name":"Windows","status":"stopped","backend":"qemu"},{"id":"D52B6480-49B5-4EC2-8EE7-EC6BBCEE002D","name":"omarchy","status":"started","backend":"qemu"}]
```

At that initial attempt the Windows guest was stopped. No guest helper, Notepad, or Calculator command was executed,
and no VM lifecycle operation or Mac mouse/keyboard input was performed. The live
snapshot -> ref action -> snapshot check was unverified at that point; the follow-up below supersedes that result.

## Verification

The final combined run exited `0`:

```sh
pnpm vitest --run packages/core/src/platform/windows
pnpm --filter @opencua/core typecheck
pnpm biome check packages/core/src/platform/windows
```

Vitest: `2` files passed, `53` tests passed (`38` backend tests and `15` transport tests).
Core typecheck passed. Biome checked `6` TypeScript files with no errors and no fixes applied.
A deliberate inversion of the physical-input guard made all `6` background physical-input
rejection cases fail; the original guard was restored before the final passing run.

An additional `pnpm typecheck:tests` run exited `2` with `6` TS4111 errors exclusively in
untouched files: `packages/core/src/passive-memory/history-capture.test.ts` at lines `63`, `74`,
and `83`, and `packages/mcp/src/history-tools.protocol.test.ts` at lines `97`, `98`, and `155`.
No Windows test type errors were reported. No builds, installs, commits, or shared-file edits
were made, and no task-created temporary artifacts or running processes remain.

## Live follow-up after coordinator startup

The coordinator started the same Windows VM. The follow-up is run with this exact command:

```sh
bun packages/core/src/platform/windows/live-check.ts
```

The retained runner uses only `/usr/bin/osascript -l JavaScript` with UTM
`execute`/`getResult`. Its readiness command is exactly:

```js
u.execute(v, {
	at: "cmd.exe",
	withArguments: ["/d", "/c", "echo OPENCUA_READY"],
	outputCapturing: true,
});
u.getResult(v.guestProcesses.byId(3224));
```

The initial readiness response was:

```json
{"errorText":"","exitCode":0,"errorData":"","exited":true,"outputText":"OPENCUA_READY\r\n","signalCode":0,"outputData":"T1BFTkNVQV9SRUFEWQ0K"}
```

The runner uploads the current embedded helper and an interactive-session driver to a unique
task-owned directory under `C:\Users\Public`. It reuses `CuaInteractive` from
`utm-windows-script.ts` for console-token, environment-block, named-pipe identity, and job
containment. Only the diagnostic payload handling is adapted in memory to carry verification
JSON instead of display dimensions. Shared files are not edited. Both physical and WM_CHAR
options are disabled. The driver creates a unique disposable document and starts guest Notepad
with `-WindowStyle Hidden`; its helper has redirected stdin/stdout and `CreateNoWindow = true`.
The process tree and task-owned files are cleaned in `finally` blocks.

The first interactive attempt, guest process `7356`, exited `1` before starting the helper.
Its exact diagnostic line was:

```text
OPENCUA_LIVE:{"error":"System.Management.Automation.RuntimeException: Notepad input readiness deadline","ok":false}
```

`WaitForInputIdle(20000)` did not establish readiness on this guest. The runner was changed to
wait for its uniquely titled Notepad window through the helper's `listWindows` operation instead,
with a 60-second deadline. The failed attempt's cleanup exited `0` and printed:

```text
CLEANED C:\Users\Public\opencua-windows-live-a6846e2e-45cf-4445-bb5c-f6c1d99a8e28
```

The second attempt used guest process `11980`. Its host runner failed while trying this
cleanup command through UTM:

```js
u.execute(v, {
	at: "taskkill.exe",
	withArguments: ["/PID", "11980", "/T", "/F"],
	outputCapturing: true,
});
```

The cleanup exception masked the original live-run exception, so no snapshot/action result
from that attempt is claimed. A subsequent exact query:

```sh
/usr/bin/osascript -l JavaScript -e 'function run(){const u=Application("$HOME/Applications/UTM.app"); const v=u.virtualMachines.byId("E7610018-F723-475D-9B98-DAF94E769CDB"); return JSON.stringify({status:v.status(),result:u.getResult(v.guestProcesses.byId(11980))});}'
```

returned:

```text
execution error: Error: Error: PID lld does not exist (-2700)
```

The runner now attempts file cleanup even when process termination fails, prints every guest
PowerShell pid and its unique scratch path before use, and allows 120 seconds per UTM scripting
call and 300 seconds to collect the interactive run. These are live-harness recovery changes,
not evidence that the native backend passed.

The recovery audit command was:

```sh
bun packages/core/src/platform/windows/live-check.ts --audit
```

It exited `0`. Exact `outputText` (excluding its final CRLF):

```json
{"userScratch":[],"processes":[{"ProcessId":10364,"ParentProcessId":10244,"Name":"Notepad.exe"},{"ProcessId":7200,"ParentProcessId":1796,"Name":"Notepad.exe"},{"ProcessId":9488,"ParentProcessId":12144,"Name":"powershell.exe"}],"directories":[{"path":"C:\\Users\\Public\\opencua-windows-live-883448f2-30aa-48db-a970-93b64c3f50b4","created":"2026-11-01T18:20:23.5639902Z","files":["driver.ps1","helper.ps1"]}]}
```

There was no surviving helper/interactive PowerShell from process `11980`; `9488` was the audit
command itself. The two Notepad processes were not terminated based on an unproven ownership
assumption. The remaining public directory was identified by the exact embedded-helper SHA-256
before this cleanup command was allowed to delete it:

```sh
bun packages/core/src/platform/windows/live-check.ts --cleanup-owned 'C:\Users\Public\opencua-windows-live-883448f2-30aa-48db-a970-93b64c3f50b4'
```

Guest process `1280` exited `0` and printed exactly:

```text
CLEANED C:\Users\Public\opencua-windows-live-883448f2-30aa-48db-a970-93b64c3f50b4
```

With the longer collection deadline, guest process `9408` returned this exact diagnostic:

```text
OPENCUA_LIVE:{"windows":["","Program Manager"],"ok":false,"error":"System.Management.Automation.RuntimeException: Notepad window did not appear within 60 seconds","launcherPid":9112}
```

This exposed a native discovery bug: walking only UIA root children omitted the hidden
Notepad HWND. `helper.ts` now enumerates positive-sized top-level Win32 windows through
`EnumWindows`, reads their titles with `GetWindowText`, and resolves the exact HWND through
`AutomationElement.FromHandle`. It does not activate a window or move a pointer.
The failed attempt cleaned its directory with exit `0`:

```text
CLEANED C:\Users\Public\opencua-windows-live-2bbafdbc-c029-4776-8b25-06ba1a886acb
```

The next run, guest process `2032`, proved discovery was fixed. Its exact diagnostic was:

```text
OPENCUA_LIVE:{"ok":false,"before":{"key":"58df9b36de754719ba199b28087b0177:4807926a615346b88a429d264b00cc63","pid":1572,"elements":1,"windowId":66612},"error":"System.Management.Automation.RuntimeException: Notepad exposes no writable ValuePattern","roles":[{"label":"OpenCUA-live-06a1fdebe33b470ba44bc0148c5f9a43.txt - Notepad","actions":[],"role":"AXWindow"}]}
```

UIA exposed the hidden window but not its edit children. The driver now shows only its own
guest Notepad HWND using `ShowWindow(hwnd, 4)` (`SW_SHOWNOACTIVATE`) before the semantic
workflow. This is a guest-window visibility operation without activation, not physical input.
It records the guest foreground HWND and cursor before that operation and asserts both remain
unchanged after the UIA action and verification. No Mac input API is used. Process `2032` also
cleaned its task-owned directory with exit `0`:

```text
CLEANED C:\Users\Public\opencua-windows-live-d09fb8e9-eb8b-4a57-b9d8-a0814d9572b3
```

During this work the shared repository migrated from Vitest to Bun and removed the Vitest
executable. The Windows tests were updated to the current `bun:test` and
`@opencua/test-support` imports without removing assertions or cases. The original requested
`pnpm vitest --run packages/core/src/platform/windows` now exits `254` with:

```text
ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command failed with ENOENT: vitest --run packages/core/src/platform/windows
Executable not found in $PATH: "vitest"
```

The first Bun run exposed a test-runner difference: asserting a pending rejection before
triggering its fake process event blocked the test under Bun. The transport tests now register
an outcome handler before the event and assert the settled rejection afterward. The same
53 cases and error-code assertions are retained, with deterministic fake timers and no sleeps.

One subsequent collection, process `6180`, failed with this exact UTM error:

```text
execution error: Error: Error: Timed out waiting for RPC. (-2700)
```

Its termination request returned exit `128`, `ERROR: The process "6180" not found.`, and file
cleanup exited `0`:

```text
CLEANED C:\Users\Public\opencua-windows-live-e576a0f3-7153-4b3b-a672-5a1d7a29ac96
```

The runner now writes the authenticated child's final JSON to `result.json` in its task-owned
guest directory before returning the one-shot UTM process result. If status collection fails,
it reads that durable evidence without replaying the UI action. Parent launch/pipe failures are
also retained in `native-errors.txt`. Both files are removed with the directory during cleanup.

## Final live result: PASS

Exact command:

```sh
bun packages/core/src/platform/windows/live-check.ts
```

Readiness succeeded on attempt `1`, guest process `7360`, exit `0`, stdout
`OPENCUA_READY\r\n`. Helper upload process `9856` and driver upload process `11964`
both exited `0`. The interactive parent was guest process `2472`; it exited `0`.

The three semantic calls made by the retained driver, with their actual observed parameters, were:

```powershell
Call 'snapshot' @{windowId=263158;options=@{includeScreenshot=$false}}
Call 'action' @{
	pid=7960
	snapshot='0cf8e313d00d409b83303e6f7743e00c:9c9b410316914d56848eb86af15870df'
	ref=2
	action='setValue'
	value='OpenCUA verified through background UIA'
}
Call 'snapshot' @{pid=7960;windowId=263158;options=@{includeScreenshot=$false}}
```

Exact `outputText` line, followed by CRLF:

```text
OPENCUA_LIVE:{"background":{"foregroundAfter":263158,"foregroundBefore":263158,"cursorUnchanged":true},"ok":true,"before":{"ref":2,"elements":41,"key":"0cf8e313d00d409b83303e6f7743e00c:9c9b410316914d56848eb86af15870df","value":"OpenCUA before live check","pid":7960,"windowId":263158},"after":{"key":"0cf8e313d00d409b83303e6f7743e00c:5af6327fb3f04b5ebc14bde4bb6e2dec","ref":43,"value":"OpenCUA verified through background UIA"}}
```

The Notepad HWND was already guest foreground at the pre-action measurement. This proves that
the semantic workflow did not change that foreground HWND or the guest pointer; it does not
claim this particular Notepad window was nonforeground. The action went through ValuePattern,
with physical input and WM_CHAR disabled. The Mac's mouse, keyboard, focus, and VM lifecycle
were never operated.

The existing native launcher confirmed the task-owned child/process tree exited before reporting
success. Guest cleanup process `10928` exited `0`, with exact stdout:

```text
CLEANED C:\Users\Public\opencua-windows-live-48cb1936-3c77-4750-89b6-da07f5f3ee4d
```

No task-owned guest scratch directory or running helper/Notepad process remains from the final
run. Previously recovered task-owned public directories were also removed as recorded above.
Unattributed pre-existing Notepad processes were left alone. The VM was left running for the
coordinator.

Final checks against the migrated repository all exited `0`:

```sh
bun test --isolate packages/core/src/platform/windows
pnpm --filter @opencua/core typecheck
pnpm biome check packages/core/src/platform/windows
pnpm typecheck:tests
```

Exact final scoped summary:

```text
53 pass
0 fail
112 expect() calls
Ran 53 tests across 2 files. [237.00ms]
> @opencua/core@0.1.0 typecheck $REPO/packages/core
> tsgo --noEmit
Checked 7 files in 24ms. No fixes applied.
```

The additional workspace test typecheck also passed; it supersedes the earlier historical
TS4111 failures. The original Vitest command remains unavailable after the coordinator's Bun
migration. No dependency was added or reinstalled to work around it. The follow-up changed only
`helper.ts`, `live-check.ts`, `windows.test.ts`, `transport.test.ts`, and this README inside the
owned Windows directory. No commits, shared-file edits, or VM lifecycle/configuration changes
were made.

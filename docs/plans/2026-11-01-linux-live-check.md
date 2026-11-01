# Live check, November 1, 2026

Requested target: `omarchy`, QEMU UUID
`D52B6480-49B5-4EC2-8EE7-EC6BBCEE002D`, through
`$HOME/Applications/UTM.app`.

Result: blocked before guest execution. The running UTM application did not expose
the requested VM. No other VM was substituted, and no VM was started, stopped,
reconfigured, or controlled through Mac input. No guest files were created.
Guest-agent availability and GI dependencies remain unknown.

## Exact attempted execution

Host executable: `/usr/bin/osascript`.
Arguments: `-l`, `JavaScript`, `-e`, followed by this exact source argument:

```js
function run(){ const u=Application("$HOME/Applications/UTM.app"); const matches=u.virtualMachines().filter(v=>v.id()==="D52B6480-49B5-4EC2-8EE7-EC6BBCEE002D"); if(matches.length!==1) throw Error("Exact VM not found"); const v=matches[0]; if(v.status()!=="started" || v.backend()!=="qemu") throw Error("Expected running QEMU VM"); const p=u.execute(v,{at:"/bin/sh",withArguments:["-lc","id; command -v python3; python3 -c 'import gi; gi.require_version(\"Atspi\", \"2.0\"); from gi.repository import Atspi; print(\"AT_SPI_IMPORT_OK\")'"],outputCapturing:true}); return JSON.stringify({guestProcessId:p.id()}); }
```

Exit code: `1`. Output:

```text
execution error: Error: Error: Exact VM not found (-2700)
```

The intended guest command, which was **not executed**, was:

```sh
/bin/sh -lc 'id; command -v python3; python3 -c '"'"'import gi; gi.require_version("Atspi", "2.0"); from gi.repository import Atspi; print("AT_SPI_IMPORT_OK")'"'"''
```

## Read-only identity confirmation

Same host executable and arguments, with this source argument:

```js
function run(){const u=Application("$HOME/Applications/UTM.app"); return JSON.stringify(u.virtualMachines().map(v=>({id:v.id(),name:v.name(),status:v.status(),backend:v.backend()})));}
```

Exit code: `0`. Output:

```json
[{"id":"E7610018-F723-475D-9B98-DAF94E769CDB","name":"Windows","status":"started","backend":"qemu"},{"id":"39E9659F-6A3B-4976-B8D2-F49D7FE0CBA5","name":"Linux","status":"started","backend":"qemu"}]
```

Live snapshot, ref action, and verification snapshot were therefore not run.
The helper's native AT-SPI, X11 capture, Wayland portal, and uinput integration
remain unverified on Linux.

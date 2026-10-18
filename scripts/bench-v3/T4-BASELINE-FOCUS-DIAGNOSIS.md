# Retained T4 baseline focus diagnosis

Read-only investigation, 2026-10-11. COMPATIBILITY.md and PREREGISTRATION.md
were read first. No pilot was rerun, no GUI input or app launch was issued,
and no baseline substitution is proposed. Both disturbed exploratory outcomes
and their stopped status remain unchanged.

## Finding

The recorded agents explicitly requested background delivery for their input.
Neither retained call stream shows foreground escalation or bring-to-front.
This does not establish backend compliance. Cua's first activation precedes
its first recorded driver call; native's first activation falls near the
background paste batch, but an exact overlap cannot be established from the
retained clocks. Attribution remains unresolved, not proven agent API misuse
and not a proven backend defect.

The raw is `.bench/v3/apps-agent-t4-baseline-smoke.json`: native row begins
at line 41, Cua row at 1863. Both task/control oracles and cleanup pass;
both focus-disturbance flags are true and pointer-disturbance flags false.
These are n=1 exploratory pilots per route, not paired scored coverage.
The producer continued from native to Cua despite the first safety flag;
LEDGER.md:201-209 records that historical gating failure and the later repair.
It does not authorize further baseline input.

## Exact transcript references

Paths below are the raw's recorded agent workspaces, not reconstructed runs:

- Native: `/var/folders/y0/mkpd4qc10l7259st4ng4s0xc0000gn/T/cua-bench/v3/agents/omo-native-50525-1791713564646-4f7ba212bb7e3/stdout.raw`
- Cua: `/var/folders/y0/mkpd4qc10l7259st4ng4s0xc0000gn/T/cua-bench/v3/agents/omo-cua-50525-1791713634976-aefad28ea008b/stdout.raw`
- Cua driver telemetry: `/var/folders/y0/mkpd4qc10l7259st4ng4s0xc0000gn/T/cua-bench/v3/agents/omo-cua-50525-1791713634976-aefad28ea008b/driver.raw.jsonl`

Line references below refer to these files. Large transcript searches were
bounded; the decisive full JSON lines were read separately. Cua search reports
only first-4-MiB coverage, so it is not evidence about uninspected trailing
transcript data. Its complete 23-line driver telemetry was read.

## Cua timeline and contract

Raw lines 2298-2330 record Terminal at trace start, TextEdit activation at
115 ms, and TextEdit still frontmost at trace end (115849 ms). There are no
pointer events or cursor changes.

Cua transcript line 1 starts the session at 10:13:55.216Z. The first
model-facing tool is tool_search (line 68), followed by discovery/resource
reads. The first driver call is list_windows, recorded at line 702 and in
telemetry request id10. Its eval starts at epoch 1791713668518
(10:14:28.518Z), and returns at 1791713668572 (line 833).

Even if the trace started as late as the agent workspace creation time
1791713634976 recorded in the raw, its 115-ms activation would be no later
than 10:13:55.091Z, over 33 seconds before list_windows. This bound relies
on the documented trace-before-agent ordering, not on an independently
retained epoch for trace start. LEDGER.md:204-205 explicitly notes that the
historical trace includes setup. The activation is consequently not
temporally explained by the later hotkey/type_text requests. No retained
setup dispatch log identifies which fixture operation surrounded 115 ms;
TextEdit fixture setup is a candidate, not an established cause.

Transcript lines 11-12 explicitly instruct "Use background delivery only."
Recorded discovery schema at line 131 says hotkey background injects
"without fronting or raising the target" and type_text background has
"no focus steal"; foreground is a separate explicit re-call. It also says
window_id does not itself raise the window.

Telemetry records the two input requests:

- id18: hotkey, exact Safari PID5190/window18225, x223/y265, cmd+v,
  `delivery_mode:"background"` (telemetry lines 15-16).
- id20: type_text, same exact window, element token `s0000095d:5`,
  exact marker, `delivery_mode:"background"` (lines 19-20).

Other telemetry requests are window observations and clipboard read/write.
There is no bring_to_front request. The hotkey result (transcript line 2137)
reports background synthetic events with effect unverifiable and recommends
foreground escalation; the subsequent request remains background.
An escalation recommendation is not an issued foreground request. These
later inputs cannot establish the cause of the first TextEdit activation.

## Native timeline and contract

Raw lines 324-365 record Terminal at both endpoints, an activation with empty
bundle at 39887 ms, and Terminal restoration at 40410 ms: 523 ms apart.
The empty bundle does not identify the activated process. There are no
pointer events or cursor changes. Trace duration is 67150 ms.

Native transcript line 11 explicitly requires background delivery. Discovery
line 261 exposes generic computer call chains, not helper-level default
delivery semantics. Two attempted skill reads fail ENOENT (lines 176 and
393); that is a documentation-access finding, not proof of an input error.
Capabilities (line 570) advertise Quartz, backgroundWindowInput true,
background/foreground delivery modes and focusGuard true. Those reports
are not proof that focus remained undisturbed.

The relevant consecutive calls are:

| Transcript line | Call | Retained epoch time |
|---|---|---|
| 1354 / result1612 | Read TextEdit ref e3 value; Safari window18204 AX tree | cell start1791713599312, result1791713599461 |
| 1679 / result1998 | Clipboard write; Safari ref e37 background click; window18204 cmd+v background press | cell start1791713602837, result1791713605294 |
| 2043 | Re-read Safari AX tree to verify field | follows paste result |

Result line 1998 retains all four nested calls: clipboard.write (25 ms),
ref resolution (5 ms), click with `delivery:"background"` (2169 ms),
and press with `delivery:"background"` (253 ms). All report success.
No foreground request is visible. These nested calls are not separate
model-facing calls and there is no native timestamped driver proxy stream.

An approximate alignment is possible, but must not be treated as exact:
raw agent elapsed is 65435.029 ms, workspace epoch1791713564646,
and trace duration67150 ms. Assuming stable clocks, trace-before-agent
and trace-stop-after-agent, the first activation would lie approximately
between epoch1791713602818 and1791713604533. The latter bound uses agent
start as the latest possible trace origin; the former uses agent end as
the earliest possible trace endpoint. This places it after the preceding
value/AX read and near the paste batch, potentially 19 ms before that
batch begins or during its background click. The restoration would lie
approximately between1791713603341 and1791713605056.

There is no retained absolute activation timestamp, trace-ready epoch, or
per-nested-call epoch to distinguish those possibilities. Do not label the
click or press causal from this approximate interval. A backend/helper
activation during the requested background path is plausible; unrelated
activation remains possible, and the unnamed application is unresolved.

## Provenance and verification limits

The historical raw pins apps-agent-run.mjs hash
`40112ce01f089355ae5e19030a746f2c441289afa603bdedf026c3897b23253a`
and disturbance.swift hash
`2cbc97cab1c6503f567e1df31b7fb823621a7a4daf83b710c4dd88032a4e4f01`.
Current source was inspected only to understand the measurement structure,
not asserted byte-identical to those historical sources. Current
apps-agent-run.mjs:915-968 starts the trace before TextEdit/Safari setup
and agent launch, and lines1030-1039 stop it after agent/oracle work;
current disturbance.swift measures activation ms relative to a local Date.
Its prospective streamed events and current phase labels must not be
retroactively assigned to these rows. PREREGISTRATION A30 documents that
instrumentation boundary; A33 keeps disturbed baselines safety-unavailable.

Missing decisive evidence is a common absolute clock for trace and setup,
the activated native PID/bundle, and backend dispatch/activation logs for the
historical executable versions. This investigation adds no live/backend
verification and does not recompute historical oracle booleans: COMPATIBILITY
and LEDGER already disclose missing full offline oracle inputs in these early
pilots. Final focus summaries alone cannot fill any of these gaps.

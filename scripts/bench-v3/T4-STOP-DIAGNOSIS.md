# A33 cleanup stop

The cohort stops with exit1 after attempt16. Its task oracle passes, but
cleanup records `TextEdit:other.txt`; attempts17-30 were not collected.
The raw file remains unchanged and is not a complete thirty-attempt cohort.

Attempt15 owns control window20203; attempt16 owns control window20228.
Attempt16's archived closure snapshots include both windows. Window20228
becomes offscreen with an empty TextEdit AX inventory, zero model count and
no matching AXDocument. Prior window20203 is also present offscreen in those
snapshots. The cleanup detector receives only the current row's refreshed
closures and the run's initial window IDs. It therefore has no exact closure
entry for the prior attempt's retained window20203.

This makes a retained prior-attempt WindowServer surface a concrete competing
cause, alongside a transient current surface or a stale inventory. The raw
leftover label contains only owner/title, not PID/window ID, and the final
cleanup snapshot is not archived. It cannot distinguish20203 from20228.
Do not call the cause proven or rewrite attempt16 as safe completion.

Independent post-stop probes exit0: TextEdit PID25961 has no AX windows,
zero documents and no AXDocument matching the exact owned control path.
Safari PID5190 has no AX windows; model20231 is hidden with zero tabs.
The readback is preserved in `apps-agent-t4-stopped-readback.json`.

Before further collection, reproduce the detector failure with two successive
owned closures, preserve exact leftover identities and the decision snapshot,
and require fresh document/model/AX evidence before accepting any retired
prior-attempt surface. Do not suppress all offscreen windows by title or
treat a later absence check as contemporaneous proof.

The deterministic successive-closure regression fails before the new refresh
function and passes after it. The runner now refreshes prior exact closed
identities and archives its cleanup decision snapshot. All223 benchmark tests
and the scoped Biome checks pass with exit0. Native dist remains unchanged.
A34 registers separate two-attempt live QA before any further scored collection;
the root-cause limitation and A33 cleanup failure remain retained.

A34 verifies both task oracles but stops at cleanup on exact offscreen TextKit
surfaces20294/PID87169 and20295/PID87203. The new decision snapshot confirms
the sequential owned closures now have empty fresh inventories. Post-stop
target inventories and document count are empty; both TextKit bound AX
inventories are empty. A35 separately registers classification of that exact
bundle under the existing inactive-service rule and another two-attempt QA.
Its regression fails before the addition; all224 tests and scoped style pass.
The failed A34 remains preserved in its raw and stopped-readback artifact.

A35 completes2/2 with verified task, raw usage, exact closure and safety
evidence; offline verification exits0. Independent final readback exits0:
TextEdit documents and target/service AX inventories empty, Safari model20368
hidden with zero tabs, and all three exact owned files absent. The raw SHA256
is217a0e873eae8934f5f1fb6510f81ccf915e1332cf5fc3dea2e7598fee121c22.
`apps-agent-t4-a35-final-readback.json` preserves the check. A36 registers a
new separate descriptive cohort, without pooling or rewriting earlier failures.

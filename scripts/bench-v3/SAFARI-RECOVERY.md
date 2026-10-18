# Safari heading fixture recovery

The exploratory heading pilot failed before driver input. Its unexpected
WindowServer surface count and ambiguous background Close Window menu are
retained in `safari-heading-prelaunch-smoke.json`; the apple slot was not
started. This is not scored driver capability evidence.

Positively owned window 6601 was independently identified by Safari's
dictionary with title `Personal — Local benchmark 8c52` and exact URL
`http://127.0.0.1:55387/page`. Recovery rechecked ID, title and URL before
requesting closure, without activation or a global key. The initial count
remained one and the bounded exact-ID absence watch timed out. Neither
the successful close request nor the later missing-current-tab error was
treated as verified absence.

Subsequent independent read-back distinguishes the retired model object:

- On-screen inventory contains no Safari window 6601.
- Safari still reports model window ID 6601, `visible:false`, `tabs:0`.
- Reading its current tab returns -1728 because there is no current tab.

Thus the owned page and visible fixture window are closed, but the retained
Safari scripting object has not disappeared. Do not claim complete object
destruction or rewrite the pilot's original cleanup failure. Further closure
requests against that empty hidden object are unnecessary.

This exposes two fixture-oracle issues to repair prospectively: counting
nonvisible WindowServer surfaces as active extra fixtures, and using scripting
object count alone as physical/tab closure evidence. Actual hidden windows
with tabs must not be conflated with these empty retired objects. Unknown
Settings window ownership and historical hidden-browser cleanup remain
unresolved and untouched.

The later `safari-heading-count-corrected-smoke.json` reached four Cua
calls. Cua refused process-scoped keyboard input because it saw another
eligible same-PID window. The trace records zero pointer movement and no
activation. Cleanup closed positively owned page window 6616, but detected
additional surface 6615 and stopped the Apple slot rather than closing an
unowned window. Keep this failure in the raw artifact.

A subsequent read-only reconciliation found no surface 6615, no Safari AX
windows, and only retired model 6616 with `visible:false`, `tabs:0`.
WindowServer likewise reports 6616 off-screen. This verifies closure of the
owned page and absence of the extra surface at read-back, not its ownership
or whether Cua's earlier ambiguity check was incorrect.

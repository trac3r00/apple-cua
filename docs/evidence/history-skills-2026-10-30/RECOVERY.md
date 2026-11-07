# Post-rollout permission-reporting recovery

## Verified failure and recovery

The user reported that macOS permissions appeared granted but apple-cua reported
that it could not work.

Before reconnecting, this thread's existing MCP connection returned:

```json
{"accessibility":false,"screenRecording":false,"inputMonitoring":true}
```

The correctly invoked installed helper self-check and a disposable fresh MCP
connection returned all three permissions as true. The existing connection
could list apps, so transport connectivity alone was not a sufficient check.

The user then ran `/mcp reconnect apple-cua` and reported `Connected`. A single
read-only `get_capabilities` call on this thread's reconnected server returned:

```json
{"accessibility":true,"screenRecording":true,"inputMonitoring":true}
```

Its blocking-advice list was empty. No macOS grants were toggled or reset.
No mouse, keyboard, focus, screenshot, or app-observation operation was sent
after the user reported reconnection.

**VERIFIED:** reconnecting resolved this connection's permission-reporting
mismatch. **INFERRED:** an existing process retained stale permission attribution
after the bundle rollout. The specific macOS caching mechanism was not proven.
Other clients may need their own reconnect; they were not restarted.

## Corrections to the investigation

- The first helper probe incorrectly passed `--doctor` directly to the launcher.
  That launcher expects `server.js` first. Exit 9 was Node rejecting an unknown
  option, not a reproduced product crash. The corrected invocation exited zero.
- The earlier read-only attempt to observe `replay.rtf` could not resolve its
  window. It is not a successful screenshot/accessibility acceptance check.
- The user reported cursor interference during the full test run. The run was
  stopped. Sampled input tests declare native mocks, but inspection did not
  establish which path caused the interference. No definitive culprit is claimed.
- Running the full native-input suite on the active desktop without first
  proving its isolation was an investigation error. It must not be repeated
  as a recovery check on the user's active desktop.

## Check results and limits

- Installed bundle deep/strict signature verification passed.
- Bundled Node started successfully.
- Correct installed helper self-check passed.
- Fresh MCP initialization/tool discovery passed.
- Repository package typechecking exited zero.
- Repository lint exited 1.
- Test typechecking exited 2 with five errors in two files.
- The stopped full suite reported 374 failed, 2218 passed, and 2 skipped tests,
  plus unhandled errors. These are the reported partial-run figures, not proof
  of a complete or clean suite. The script-test phase reported failure.
- All task-owned test runs were stopped. Disposable comparison clients were
  closed; no other client or suspended process was resumed.

This recovery verifies permission reporting, not all computer-use behavior.
Screenshot/input acceptance and safe completion of the full native suite remain
unverified. No product source code was changed for this recovery.

# Approved installed rollout

The user explicitly approved rebuilding the CLI and recorder and restarting
history. This receipt supersedes the earlier source-only delivery status.

## Installed result

- The actual launcher, `~/.local/bin/apple-cua`, runs this checkout's compiled
  CLI. Its installed help now lists `history open` and `history digest`.
- The installed helper bundle was replaced with a staged, verified bundle.
  The recorder and bundle retained the existing `dev.applecua.mcp` identifier
  and certificate-based designated requirement. No ad-hoc fallback was used.
- Deep, strict code-signature verification passed.
- The existing LaunchAgent was restarted, not removed or replaced.
  The recorder changed from PID 53704 to PID 54361 and reported `running`
  at `2026-10-30T03:42:27Z`.
- The installed recorder contains `Open history...` and `Record a skill...`.
- The installed HTTP interface returned status 200, contained the skill creation
  controls, and successfully listed 21 real history segments. Recorded content
  was not printed or sent to a model during this rollout.

## Real-data defect found and fixed

The initial installed timeline returned HTTP 400 because three existing event
files exceeded the 120,000-byte file-read limit; the largest was 189,681 bytes.
That limit incorrectly reused the model-sharing budget for local file reading.

A deterministic 1,500-event regression failed against the old reader. The
local file-read cap is now 4 MiB; selected model evidence remains capped at
120,000 bytes. The regression checks both successful listing and rejection
of model evidence exceeding the unchanged budget.

After the fix, 21 affected workflow/HTTP tests passed, scoped Biome passed, and
the compiled CLI build passed. The installed real-data timeline then returned
200 instead of 400.

## Preservation and cleanup

- Recording settings and the computer-use stop file matched their pre-rollout
  SHA-256 baselines.
- Automatic model sharing remains off; no live `automation.json` was created.
- All unexpired baseline segments remained. Two baseline segments,
  `2026-10-29T21-20-00Z` and `2026-10-29T21-30-00Z`, expired under the recorder's
  existing six-hour retention policy while recording continued. The installer
  did not clear history.
- The verification UI servers were closed. The staged bundle, old-bundle
  rollback copy and task-owned temporary directories were removed after checks.
- No Git commit was made and the computer-use stop switch was not resumed.

## Verification limits

The native menu was not clicked automatically. The app-observation tool could
not resolve the accessory process, and a read-only System Events query was denied
assistive access. Process state, installed binary labels, signature integrity,
and the installed HTTP workflow were checked independently. Native skill replay
remains unverified while the user stop switch is set.

To use the installed feature, open the **apple-cua** menu-bar item and choose
**Open history...** or **Record a skill...**.

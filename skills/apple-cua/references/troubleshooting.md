# Troubleshooting without blind input

Do not test an installation or a hypothesis by clicking arbitrary controls. Stop input,
inspect the error/current context, and resolve the specific cause. Never remove targeting,
expand your own approval policy or switch to raw input to evade a guarded MCP denial.

## App not approved

The host's `APPLE_CUA_ALLOWED_BUNDLE_IDS` is empty or does not contain the exact bundle ID.
`list_apps` can show IDs for human setup; listing is not approval. Ask the host owner to
configure the intended app and restart the server. An observation token cannot override
approval and an app allowlist does not replace consent for irreversible actions.

## Missing, stale or replayed observation token

Call `get_app_state` for the actual target and read the response before choosing input.
Pass its `observation_token` with the next mutating tool call. A token is single-use;
another explicit observation replaces it. Do not reuse a token from another app/session,
cache one across turns without checking the current result, or replay a failed request.

A paused result requires a new explicit observation. That observation should answer a
specific question about the blocker or intended result, not serve as a mechanical step
in an endless observe/click/retry loop.

## Target app is not foreground, or its window changed/disappeared

The pre-input check refuses to guess. Ensure the user-intended app is running with the
correct visible window in front, then observe it again. A new dialog or different window
may need different targets. Do not use coordinates from the previous window or change
`app` while keeping the old token. If the target is unavailable, ask for help rather than
falling back to global clicks.

## Element is not in the observation

`element_index` is the returned element's **`id`**, not its index in the `elements` array.
Normalization can leave gaps in IDs. Refresh the observation if the context changed; choose
an element actually present in the current result. An advertised action name must also be
appropriate for that control. The root application is not a text field.

## AX action fails or the outcome is unclear

Native AX errors are meaningful, not invitations to retry blindly:

- `-25200`: generic failure.
- `-25205`: unsupported attribute.
- `-25206`: unsupported action.

Different apps expose different capabilities. An action rejected on one control does not
prove all native input is broken. Re-observe the intended target and inspect a relevant
state signal. If the supported AX route cannot express the operation, a screenshot-guided
coordinate action may be appropriate only within valid current MCP context and authorization.

`observationStatus` describes the AX comparison, not task success. Focus, selection or visual
changes might not change AX diff counts; conversely, unrelated UI activity can change counts.
Check the intended field value, selection, result or confirmation instead of repeating input.

## URL policy cannot be checked

A configured URL restriction must not be bypassed because browser automation failed. Resolve
the browser/Automation permission issue with the host owner, or stop. Do not disable the
blocklist, use another process or turn a failed lookup into permission to act.

## Screenshot is black, missing or unusable

Check capture errors and Screen Recording permission for the actual launcher. A service may
have different grants from the terminal used to build the project. Resolve permission through
human-operated System Settings. If the harness did not deliver image content to the model,
use valid AX targets or stop; an image file's existence is not visual understanding.

## CLI/server command not found

Use the explicit built paths from the checkout rather than assuming a bin alias:

```bash
pnpm --filter @apple-cua/core --filter @apple-cua/cli --filter @apple-cua/mcp build
node packages/cli/dist/cli.js --help
```

The MCP server is `node /absolute/path/to/apple-cua/packages/mcp/dist/server.js`; it speaks
stdio JSON-RPC and is not a CLI with `--version`. Let the harness launch it with the approved
bundle-ID environment. Do not print log messages into its protocol stdout.

## Coordinates land incorrectly

Use dimensions from the current MCP screenshot/token, not a fixed 1280/2560 size or assumed
Retina factor. Raw CLI input uses global logical points and is a separate low-level surface.
Do not keep trying scaled variants on live controls. Obtain the right window observation and
verify the coordinate space before input.

## Interleaved inputs or wrong active app

Use one controlling agent/server for the desktop. Disable parallel tool scheduling in the
harness configuration; the server also queues its own transactions, but cannot arbitrate
another process or a human changing focus. Stop conflicting controllers and observe again.

For a bug report, capture the relevant tool name, target metadata and complete error while
redacting private document/image content. Include version/build and launcher information;
do not substitute a successful unit suite for a real reproduction.

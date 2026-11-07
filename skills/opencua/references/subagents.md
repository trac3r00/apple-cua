# Subagents, workers, and virtual cursors

One coordinator owns the task and the final verification. Subagents are optional: use them
only when two or more **independent** targets can make progress at the same time. A single
form, a single document, or a sequence whose next step depends on the last is faster with one
`run_steps` or `run_script` call.

## Desktop apps

1. The coordinator assigns one disjoint app per worker with
   `manage_workers {op: "assign", assignments: [{worker_id, task, app}, ...]}`.
   The answer carries each worker's `cursor_id`, its observation, and its one-use token.
2. The coordinator spawns one host subagent per assignment. Pass only that worker's
   `worker_id`, token, app, task, and expected outcome. A worker id is attribution, not
   authentication; every worker still uses the coordinator's MCP session.
3. A worker refreshes only through `manage_workers {op: "observe", worker_id}` and mutates only
   through `run_worker` with its current token. It must not call `get_app_state` or any other
   unscoped observation on its app, because that replaces its token.
4. Workers return what they dispatched, what they independently read back, any refusal, and
   any remaining uncertainty. The coordinator verifies the combined outcome itself before
   releasing owners with `manage_workers {op: "release", worker_id}`.

The host spawns the language-model agents; the MCP server supplies bounded execution and
cursor ownership. Use one shared server session. Attended input remains serialized; background
apps can run concurrently. Do not split two windows of one app between workers.

### Prompt template

```text
You own worker "<worker_id>" for app "<app>". Your assignment token is "<token>".
Task: <task>. Expected observable outcome: <outcome>.
Use only manage_workers(op: "observe", worker_id: "<worker_id>") to refresh and
run_worker(worker_id, observation_token, steps, expect) to act. Do not observe or
mutate any other app. Do not reuse a token. Stop on refusal or uncertainty and report
the exact message, completed steps, and what you could verify. Return the read-back
value or visible result, not a claim that the action was dispatched.
```

### Host examples

`get_capabilities` reports `host` (the connected harness, from the client's initialize
`clientInfo` or its environment) and `host.workers`; every `manage_workers` assign answer repeats
it as `spawn`. `concurrent: true` means background delivery lets workers on distinct apps act at
the same time; `false` (attended) serializes their input, so extra workers only add overhead.
Start every worker in one round so they overlap. Worker refreshes omit screenshots unless
`include_screenshot: true`, which keeps rounds fast and cheap.

| `host.name` | How to start one worker per assignment |
|---|---|
| `omo` | One `task` call with a `tasks` batch and `run_in_background: true`, one item per worker; join, verify, then release. |
| `claude-code` | One `Task` (Agent) subagent per assignment, all launched in the same message; collect, verify, then release. |
| `codex` | Its subagent/worker facility when the build has one, keeping one MCP session; otherwise one `run_parallel` call per round. |
| `hermes`, `openclaw` | The host's delegation channel with the same prompt and worker identity. |
| `pi`, `gemini`, `cursor`, `unknown` | The host's own spawn tool if it has one; otherwise one `run_parallel` call per round. |

If the host cannot spawn subagents, keep the coordinator as the only actor and use
`run_parallel` for independent apps.

## Browser pages

Each browser subagent owns one named space:

1. Coordinator: `browser_space {space: "research-1", worker_id: "research-1"}`.
2. Keep the returned `cursor_id`; `browser_status` lists it with the space.
3. Spawn the subagent with its space, page label, worker id, cursor id, goal, and the exact
   `expect` text. It uses only `browser_*` calls with that space.
4. The coordinator verifies the combined result, then each subagent calls `browser_finish` for
   its own space.

Different tabs run concurrently; one tab is serialized. A worker cannot own two spaces. Keep
the agent window minimized: the virtual cursor is a logical ownership identity, not a visible
OS mouse or a second browser.

### Browser prompt template

```text
You own browser space "<space>" as worker "<worker_id>" (cursor "<cursor_id>").
Page label: "<page>". Goal: <goal>. Verify by expecting "<text>".
Use browser_find/browser_read to start, then browser_run with this space and page only.
Never reveal, focus, or move the agent window; never use another worker's token or space.
Finish with browser_finish for your space and report verified rows or the exact failure.
```

## iPhone

The phone is one physical surface: one owner at a time. Parallel helpers may plan, summarize,
or read supplied observations, but do not tap concurrently. Use `ios_run` for a sequence already
proven on one screen; it takes one token, up to eight steps, and one final `expect`. A covered
phone window is refused in background delivery rather than raised.

## Bounds and recovery

- Keep browser workers at four or fewer and desktop workers at the number of independent apps.
- Cancel or release a worker that stalls. Never take its token or app while it is busy.
- A stale token is refreshed by that worker's own `op: "observe"`, not by a coordinator-wide
  observation.
- A restarted app or browser connection invalidates ownership; release and reassign.

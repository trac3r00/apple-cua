# Create a skill from computer history

OpenCUA spots workflows you repeat and offers them as skill suggestions, inside your agent chat.

## In your agent (recommended)

Ask your agent "what skills could I make from my history?". With `OPENCUA_HISTORY=1` it calls
`cua_history_suggest_skills`, which scans recent segments locally: no model call, nothing leaves the
machine, and typed text is never included. It shows a numbered list of repeated workflows. Pick one, the
agent drafts the SKILL.md in the chat, and after you approve the draft it saves it with
`cua_history_save_skill` to `~/.agents/skills/<name>/SKILL.md`. Existing skills are never overwritten.

## From the terminal or menu bar

```sh
opencua history suggest            # numbered list of repeated workflows
opencua history record start       # mark one deliberate run
opencua history record stop        # prints the prompt to give your agent
```

The menu-bar item lists the same suggestions. Choosing one copies the agent prompt to the clipboard.

A suggestion is a detected repeat, not a verified macro. The agent must observe fresh app state before
acting when it later runs the skill.

## Legacy timeline page

The older localhost page is still available with `opencua history open --web`:

Select recorded segments, preview the evidence, and describe the reusable
workflow. Enable model sharing, then choose **Create skill draft**. Review and
edit the name, trigger description and instructions before choosing **Save
reviewed skill**.

Skills are saved under `~/.agents/skills/<name>/SKILL.md`. Existing skills are
never overwritten. For a separate output directory:

```sh
opencua history open --web --skills-dir /absolute/path/to/skills
```

`--no-open` prints the local session URL without opening a browser. Treat that
URL as private: its random path grants access to that history session. The
server listens only on `127.0.0.1`, closes after 15 minutes without activity,
and can be stopped with **Close history** or Ctrl+C. Closing the page does not
stop the independent recorder.

## Model requirements

Generation uses the installed OmO CLI in ephemeral, tool-free mode. It uses
OmO's configured model and authentication. `OPENCUA_HISTORY_AGENT` can select
an alternative path to an OmO-compatible executable. No model is bundled.
Unavailable credentials or executables produce an error, not a fake draft.

Recording remains local. Generating a summary or skill sends selected,
redacted evidence to the configured model, which may run remotely. The interface
requires explicit sharing consent. Typed text, selection text, accessibility
snapshots and element values are omitted. App names, window titles and target
labels can still contain private information; inspect the preview.

Generation is bounded to 120 seconds and bounded input/output sizes. There are
no autonomous retries. Selected evidence is limited to 12 segments and
120,000 UTF-8 bytes. Oversized or malformed evidence produces an explicit error.

## Summaries and replay

**Summarize** creates a local Markdown summary under cua-history's
`summaries/` directory. The interface lists its latest 50 generated summaries,
which outlive expiring raw events.

**Workflow suggestions** has a separate, persistent opt-in for automatic model
sharing. When enabled, the recorder checks each ten-minute window and invokes
`opencua history digest` for one completed segment. Structured summaries and
optional skill suggestions are stored in `summaries/auto-<segment>.json`.
Already-summarized segments do not cause another model call. The interface
shows the last background result; failures do not stop recording.

**Record a skill...** in the menu opens the demonstration controls. With the
recorder running, choose **Start demonstration**, perform the workflow, and
choose **Stop demonstration**. The resulting marker selects the corresponding
events for preview and drafting. Markers use the recorder's second-resolution
timestamps and support up to 90 minutes. Stopping a demonstration does not stop
the independent background recorder. It does not silently resume a paused
recorder.

After reviewing a saved skill, start a new agent session and ask it to use that
skill with new inputs. A generated skill is a set of instructions, not a verified
macro. Missing recorded targets or outcomes must be checked against fresh app
state before acting. Test on a disposable document first.

Replay is performed by the consuming agent with the tools available in that
session. Saving a skill does not automatically execute it or prove that it works.

## Updating an existing recorder

The new menu item requires a recorder rebuilt from the updated source. Updating
TypeScript alone does not change the already-running native menu. Run the
project's normal installation/update process and restart the history watcher
when ready. A refreshed LaunchAgent includes the exact installed CLI launcher
path; a manually launched recorder falls back to `~/.local/bin/opencua`.

# History skills and coordinated document editing

Date: October 30, 2026.

## O1. Why the skill option was missing

**VERIFIED, source inspection:** cua-history was a recorder plus controls. The
native menu offered pause, resume, reveal and quit. The CLI and MCP exposed
recording controls, but no history timeline, model-backed drafting, review form
or skill installation. This was missing product functionality, not a permission
toggle that would reveal an existing skill button.

Sources: `packages/core/native/history-recorder.m`, `packages/cli/src/history-commands.ts`,
`packages/mcp/src/history-tools.ts`, and `skills/cua-history/SKILL.md`.

**VERIFIED, vendor documentation:** OpenAI distinguishes two flows:

1. Computer History periodically summarizes permitted activity, shows a timeline,
   and can suggest a skill or automation. The user reviews the suggestion and
   asks Codex to create it.
2. Record & Replay starts a deliberate demonstration from "Record a skill",
   stops capture, drafts instructions, and uses the skill in a subsequent chat.

Sources:
- https://learn.chatgpt.com/docs/customization/computer-history.md
- https://learn.chatgpt.com/docs/extend/record-and-replay.md

The local change adds a history-to-skill review surface, opt-in periodic
summaries/suggestions and bounded demonstration markers. It is not evidence of
complete Codex feature parity. Native privacy-control parity, live capture
completeness and successful replay are separate acceptance questions, not
aliases for saving a `SKILL.md`.

## O2. What the worker system actually supports

| Requirement | Observed implementation | Remaining gap |
|---|---|---|
| Each worker has a goal | `WorkerAssignmentInput` holds a task string | No structured goal, acceptance criteria or dependency graph in that assignment |
| Each worker has its own plan | The host agent can plan independently | No persisted plan/progress contract in `WorkerCoordinator` |
| Assignments do not overlap | Duplicate worker IDs and app PIDs are refused | Ownership is per process, not document/section/range/slide |
| Independent cursor identity | Server-generated cursor IDs and token attribution | These are logical indicators, not independent OS mice |
| Independent keyboard | Targeted input and resource arbitration exist | A shared desktop does not provide an independent focus/keyboard context per worker |
| A team edits one document | No app-aware merge or revision protocol found | Document identity, edit ownership, conflicts and final artifact verification are missing |

**VERIFIED, source inspection:** `packages/mcp/src/worker-coordinator.ts:14`,
`:85`, `:186`, `:224`, and `:247`; `packages/mcp/src/worker-tools.ts`;
`packages/mcp/src/parallel-tools.ts`; `packages/core/src/computer/hands.ts`;
`packages/core/src/platform/input-lock.ts`.

The existing `docs/expectations/team-cua-2026-10-26.md` is an active plan. Its
historical measurements were not rerun here and are not new performance evidence.

## Alternatives

### A. Native coauthoring with separate editor contexts

**VERIFIED:** Microsoft's Word documentation describes coauthors' presence and
changes in a shared document. Older Word versions can require saving to exchange
changes rather than providing the same real-time experience.

Source:
https://support.microsoft.com/en-us/office/collaborate-on-word-documents-with-real-time-co-authoring-7dd3040c-3f30-4fdd-bab0-8586492a1f1d

**INFERRED design:** Put each worker in its own supported editor context and let
the product perform document coauthoring. Give workers separate sections and a
shared outline. This is closest to the classroom teamwork experience: each
participant has a cursor and sees others' changes.

Separate tabs are not separate macOS input devices. Browser-context automation
can address different tabs; native pointer input still needs arbitration.
Separate operating-system sessions or VMs provide stronger input isolation,
with additional memory/startup cost that has not been measured here.

**UNKNOWN:** Current coauthoring behavior for every Excel/PowerPoint version,
tenant configuration and file format was not tested. Word evidence must not be
presented as proof for the whole Office suite.

### B. Structured document edits through native APIs

**VERIFIED:** Google Docs `documents.batchUpdate` validates a batch before
applying it and applies the batch atomically. `requiredRevisionId` rejects a
stale revision with HTTP 400. `targetRevisionId` permits the server to reconcile
recent collaborator changes; sufficiently old revisions are rejected.

Source:
https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/batchUpdate

**INFERRED design:** Let workers propose or submit edits against explicit
document identities, named ranges or other stable anchors. Require revision
checks and inspect the final document after updates. This avoids spending GUI
actions on repetitive structured edits.

A Google Docs revision mechanism must not be assumed to exist identically in
Sheets, Slides or desktop Office. Every adapter needs its own contract. API
batch atomicity also does not mean two agents' semantic intentions cannot conflict.

### C. Isolated drafts with one integrator

**INFERRED design:** Give workers separate files or artifact sections. One
integrator applies accepted changes to the canonical document and verifies the
result. This is the most direct extension of today's coarse ownership model.
It trades continuous live coauthoring for predictable integration.

For a report project: researcher owns cited facts; spreadsheet worker owns
calculations; presentation worker owns slides; integrator owns the final report
and cross-artifact consistency. Parallelize independent work, not concurrent
writes to the same focused editor.

### D. Structured plans above existing app ownership

**INFERRED design:** Keep exclusive PID ownership as the safe initial execution
boundary. Add a coordinator record containing:

```text
worker identity
goal and observable acceptance criteria
ordered steps and dependencies
owned app/document/subresource
read or write intent
current step and state
latest observed revision/token
result artifact and verification evidence
```

These are proposed fields, not a currently implemented MCP schema. Let workers
create their own plans within their assigned goal; the coordinator checks
dependencies and ownership before authorizing actions.

## Recommendation and rationale

**INFERRED:** Start with D plus C for native desktop work. It adds explicit goals,
plans and collision control without pretending the shared Mac has multiple
independent keyboards. Add B where a stable app API exists. Use A when live
coauthoring itself is a requirement and separate supported editor contexts can
be supplied.

Do not begin by relaxing the duplicate-PID guard. Two windows in the same
process can still share focus, menus and clipboard. A window-only lock cannot
prove input isolation, and document subranges alone cannot arbitrate global
clipboard/menu operations.

## Implementation sequence and measurable checks

1. Add a plan/goal record and status reporting without changing dispatch.
   Check that each worker has distinct scope and measurable acceptance criteria.
2. Add a resource arbiter with document and shared-input claims. Acquire all
   required claims atomically or acquire none, so partial claims cannot deadlock.
   Retain the existing observation-token checks.
3. Queue or return a structured conflict before overlapping writes. On uncertain
   input outcome, observe before retrying; do not replay automatically.
4. Add one app adapter at a time. Prefer stable document IDs, named ranges, cells
   or slide IDs over positions that move when teammates edit.
5. Independently verify the combined artifact, including calculations,
   references, formatting, images and layout. Worker "done" messages are not proof.

| QA scenario | Observable pass condition |
|---|---|
| Two disjoint sections | Both requested changes survive in the final document |
| Same section claimed twice | Second writer queues/rejects before any input |
| Different documents, shared clipboard | Clipboard-consuming action sees its own intended content |
| Stale document revision | Write rejects or reconciles under the documented adapter contract |
| Worker crash during input | Claim is not handed off until input has stopped and state is re-observed |
| App relaunch | Old PID/token cannot silently address the replacement process |
| Keyboard and cursor attribution | Every input reaches its assigned context and feedback identifies its worker |
| Dependency completion | Downstream work starts only after upstream artifact and checks exist |
| Team report package | Report totals match spreadsheet; slides match the approved report; all render correctly |
| Human interruption | No stale action resumes against the wrong window or selection |

For FDD, generate operation sequences against an independent resource-ownership
model. Include acquire, release, cancellation, app relaunch and stale revision.
Use event gates, not sleeps. Assert exclusivity, atomic acquisition, no lost
updates, and deterministic recovery. These are proposed checks; no live
coauthoring campaign or performance benchmark was run in this session.

## Anti-BS audit

- **VERIFIED:** the original history UI had no skill-creation entry point.
- **VERIFIED:** existing worker ownership is per app PID.
- **INFERRED:** the staged architecture above is preferable to relaxing PID
  ownership without document/input arbitration.
- **UNKNOWN:** complete Codex parity, end-to-end Office coauthoring and any
  latency improvement. Do not mark these done from source inspection.
- **Correction:** a worker initially counted an expected schema rejection as a
  discarded fuzz case. It is an executed assertion, with zero discarded cases;
  the test and evidence accounting were corrected.
- **Correction:** a rejected first-use save was not "tests passing." It was
  reproduced, fixed and rerun. The evidence ledger records the failing run.

O1 implementation evidence is maintained separately in
`docs/evidence/history-skills-2026-10-30/README.md`. O2 is an assessment and
proposal, not a shipped collaborative editor.

### Delivery verdict

**PASS WITH CORRECTIONS for the locally tested source implementation.**
The subsequent user-approved rollout installed and restarted the CLI and recorder;
see `docs/evidence/history-skills-2026-10-30/ROLLOUT.md` for installed checks and
the real-recording size fix. Automated native menu clicking and skill replay
remain **UNKNOWN/blocked**, not passes. O2's source-backed assessment and
alternatives are delivered. No claim of complete live Codex parity is made.

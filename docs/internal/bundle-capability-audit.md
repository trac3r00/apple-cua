# Installed bundle capability audit

This audit records concrete reference locations and license evidence for installed
or previously inspected computer-use bundles. Reuse the high-level workflow ideas
as original guidance; this document does not reproduce vendor internals or make
external bundles dependencies.

## Inventory

Current installed bundle inspection in this task found:

- `~/.codex/plugins/cache/openai-bundled/computer-use/1.0.1001425/.codex-plugin/plugin.json`
  declares `Proprietary`; its installed `skills/` directory is empty.
- `~/.codex/plugins/cache/openai-bundled/browser/26.1007.21159/docs/accessibility.md`
  describes AX targeting, observation diffs and batched action/observation.
  `docs/api-use-behavior.md` describes inspecting results and avoiding blind retries.
  These inform original workflow guidance, not a native runtime integration.
- `~/.claude/plugins/cache/everything-claude-code/everything-claude-code/2.0.0-rc.1/.agents/skills/e2e-testing/SKILL.md`
  provides event/condition-based test waiting concepts; its Playwright examples
  are browser-specific, not a macOS input backend.
- The inspected OmO `browser-aside` reference was under
  `~/.omo/agent/omo-mods/manager/trash/1791239462983__browser-aside/SKILL.md`.
  It is archived browser guidance, not a current native integration candidate.

No inspected current bundle supplied a reusable native implementation. The table
below separately preserves historical comparisons; those versions are not the
current installed inventory.

| Bundle/reference | Concrete path or locator | License evidence | Reusable concept and boundary |
|---|---|---|---|
| Codex computer-use plugin, historical inspection | `ChatGPT.app` resource `unified-computer-use`, version `26.928.20755` (exact bundle path was not retained in the historical evidence) | Proprietary application/plugin; no redistribution license was established in the inspected record | REPL-backed sequences, live observation and concise diffs are design concepts only. Do not copy plugin source, schemas or assets. The earlier record says the installed `@oai/sky` tool was not exposed in that session; do not treat its presence as a usable current integration. |
| Codex in-app browser plugin, historical inspection | Resource identifier `openai-bundled/browser/26.928.21956`, file `skills/control-in-app-browser/SKILL.md`, recorded in `docs/agent-scenario-hardening.md`; exact absolute bundle path was not retained | Proprietary application/plugin; no redistribution license established | Explicit browser selection, tab lifecycle, browser documentation and a Node execution surface are comparison concepts. Not a desktop-window control API and not evidence of an executable benchmark in this workspace. |
| Cua Driver (`trycua/cua`) | Historical source revision `f68b806`, `libs/cua-driver/contract/manifest.json` as recorded in `docs/unified-cua.md`; repository URL: <https://github.com/trycua/cua> | The inspected historical record does not preserve a license file or license identifier. Verify the exact revision's license before using any implementation material. | A discoverable tool contract, health/permission reporting and background-input planning are useful design concepts. Do not copy source or represent the old contract's tool count as current. |
| OmniParser | Historical mention only in `docs/unified-cua.md`; no installed absolute path or pinned source revision was established | The historical note identifies AGPL, but no exact installed artifact or license text was verified in this audit | Perception/visual parsing is a concept for evaluating an integration boundary. No code, weights, derived implementation or asset is included. Do not treat the mention as an approved dependency. |
| OmO native computer capability, historical inspection | Capability name `computer`; Quartz backend, recorded in `docs/agent-scenario-hardening.md` | No redistribution/license evidence applies to this locally observed product capability; use its own installed terms | Background window input, focus guard, permission/status reporting and stop controls are comparison concepts, not a dependency or copied implementation. |
| apple-cua skill bundle | `skills/apple-cua/` and `skills/apple-cua/references/`; root and `packages/mcp/package.json` declare `MIT` | MIT declared locally; see repository `LICENSE` for complete terms | Local skill and references are the operating contract. Current concepts include token-guarded actions, window-scoped input, per-app input scopes, compact observations and bounded batches. |

External bundle locators above are recorded from prior inspection notes rather
than independently re-opened vendor bundle contents in this task. Where no exact
absolute path or license artifact was captured, the table says so rather than
inferring one. `docs/agent-scenario-hardening.md` preserves the dated session
evidence and limitations.

## Current reuse map

| Concept | Current apple-cua status |
|---|---|
| Background delivery | Implemented and default; `APPLE_CUA_DELIVERY=attended` opts out. |
| Independent app targeting | Implemented as per-app observation tokens and input scopes in `observe_apps`, `run_parallel` and `run_script`, with independent logical pointer positions and PID-scoped overlay markers. Native marker movement/hiding has been verified; real concurrent app-input acceptance remains under QA. The native hardware cursor is singular. |
| Display/window targeting | MCP observations report global display inventory and observed-window display association. Background actions target the observed window in place; no relocation is needed. |
| Compact observation | Implemented through `find_elements`/semantic targets, `include_screenshot: false`, `diff_only`, `max_elements`, and table output. |
| Bounded action batches | Implemented by `run_steps` (up to 20 steps), `wait_for` and optional `expect`/`verify_state`. |
| Canvas drag path | `drag` supports up to 100 screenshot-local waypoints, bounded `duration_ms`, held modifiers and left/right/middle buttons. Verify the actual app result. |
| Mouse button clicks | Implemented by MCP `mouse_button` values `left`, `right`, and `middle`; this does not imply button-state cursor feedback. |
| Waypoint cursor guidance and cursor button-state feedback | Drag samples update the target PID marker directly. The overlay supports independent PID markers and pointer, scroll, thinking and click modes; distinct held-button feedback is not provided. |
| Pressure/tilt, multi-touch and scene editing | Not provided. Mouse gesture paths do not imply tablet or scene-editing APIs. |
| Third-party perception, browser runtimes or model execution | Separate integration surfaces; not implicitly part of apple-cua. |

## Reuse rules

- Reuse observable behavior as a product idea, then implement it independently
  against apple-cua's own guarded protocol and tests.
- Reuse original workflow guidance, not vendor internals. Do not copy proprietary
  schemas, code, prompts, images, models or assets into this skill or audit.
- A separately proposed dependency requires its exact source, license and notices
  to be verified independently before review.
- A license label alone does not establish compatibility for a different version
  or artifact. Keep the pinned source revision and license text with any future
  dependency review.
- Do not infer that an installed path is callable by this agent, authorized for
  this session, or suitable for a matched benchmark.

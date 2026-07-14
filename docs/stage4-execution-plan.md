# Stage 4 Execution Plan

Stage 4 is the final planned Flapstack stage. Its ten feature boards contain 77
independently pick-up-able tasks. This document orders those boards without
duplicating task state; the checkbox in each OpenSpec `tasks.md` is authoritative.

## Baseline and entry gate

- Planning branch: `codex/stage4-features`, created from `main` at `25536be`.
- Integrated implementation starts only after the Stage 3 release baseline and
  its remaining live/provider/package evidence are closed or recorded as exact
  blockers.
- Stage 4 remains local-first. No hosted Flapstack service, hosted sync, or
  arbitrary control of first-party vendor sessions enters this stage.

## Pickup contract

Each task owns one bounded result and includes its parent, outcome, scope,
out-of-scope boundary, acceptance criteria, verification, blockers, downstream
blocks, and code context. An implementer may pick up one task without inheriting
the rest of its feature when all listed blockers are closed.

Before work:

1. Start from the latest Stage 4 integration commit in a clean task worktree.
2. Read the feature proposal, design, delta spec, and the selected task.
3. Confirm every `Blocked by` ID is complete. Do not silently absorb a blocker.
4. Record any discovered contract conflict in the feature board before coding.

During and after work:

1. Keep changes inside the selected task's scope and named integration seams.
2. Add the focused tests named by the task before broad verification.
3. Run the smallest relevant checks, then the feature or repo gate required by
   the task. Leave live, package, provider, and OS evidence open until observed.
4. Update only the selected authoritative task checkbox and supporting evidence.

Suggested branch names use `codex/s4-fN-tN-short-name`. One task branch should
contain one reviewable outcome; a feature lane may keep a longer-lived worktree
only when sequential tasks touch the same migration or service seam.

## Authoritative feature boards

| Feature                      | Tasks | Board                                                        | Independent outcome                                                         |
| ---------------------------- | ----: | ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| S4-F1 Unified skills/hooks   |     7 | `openspec/changes/add-unified-skills-hooks-manager/tasks.md` | Native extension inventory, policy, safe editing, sharing, and hook control |
| S4-F2 Knowledge vaults       |     6 | `openspec/changes/add-project-knowledge-vaults/tasks.md`     | Typed project knowledge with explicit context and safe agent operations     |
| S4-F3 Multi-agent operations |    10 | `openspec/changes/extend-multi-agent-operations/tasks.md`    | Selectable engines, workflows, fleet, reasoning, policy, and safe controls  |
| S4-F4 Saved workspaces       |     7 | `openspec/changes/add-saved-workspaces/tasks.md`             | Manual and orchestration-owned multi-pane workspaces across windows          |
| S4-F5 Automation             |     8 | `openspec/changes/add-local-automation-scheduler/tasks.md`   | Default-safe in-app scheduling, triggers, approvals, history, and kill      |
| S4-F6 Local models           |     8 | `openspec/changes/add-local-model-harness/tasks.md`          | Ollama-first app-owned agent loop with capability-gated tools               |
| S4-F7 Usage/limits           |     7 | `openspec/changes/extend-advanced-usage-limits/tasks.md`     | Reconciled attribution, forecasting, budgets, alerts, and export            |
| S4-F8 Portability/sync       |     8 | `openspec/changes/add-portable-import-export-sync/tasks.md`  | Versioned selective bundles and explicit user-owned private git sync        |
| S4-F9 Plan/Kanban            |     8 | `openspec/changes/add-plan-kanban-workflow/tasks.md`         | Read-only plans, real task cards, and approval-gated proposals              |
| S4-F10 Mobile companion      |     8 | `openspec/changes/add-mobile-control-companion/tasks.md`     | Default-off LAN PWA for bounded monitoring, steering, and approvals         |

## Dependency waves

Waves are readiness groups, not permission to bypass each task's exact blockers.
Tasks inside one wave can run in parallel when they do not share a migration,
schema, or generated-file seam.

### Wave 0 — Close the Stage 3 entry gate

- Finish or explicitly block the remaining Stage 3 live, provider, platform,
  package, approval/audit, orchestration, and extension evidence.
- Freeze the shipped contracts consumed by S4-F1-T1, S4-F3-T1, S4-F5-T1,
  S4-F6-T1, and S4-F10-T1.

### Wave 1 — Establish feature contracts and additive schemas

- S4-F1-T1, S4-F2-T1, S4-F3-T1, S4-F4-T1, S4-F5-T1, S4-F6-T1,
  S4-F7-T1, S4-F9-T1, and S4-F10-T1; S4-F3-T6 follows S4-F3-T1.
- Resolve migrations and shared enums before feature UI work begins.
- S4-F8-T1 intentionally waits for S4-F1-T3, S4-F2-T2, and S4-F4-T2 so its
  scope registry describes real persisted data instead of guesses.

### Wave 2 — Build independent core services

- Extensions: S4-F1-T2, then S4-F1-T3 and S4-F1-T4.
- Vaults: S4-F2-T2, then S4-F2-T3 and S4-F2-T4.
- Operations: S4-F3-T2 and S4-F3-T4; S4-F3-T3 follows the fleet view.
- Workspaces: S4-F4-T2, then S4-F4-T3.
- Automation: S4-F5-T2, then S4-F5-T3 and S4-F5-T4.
- Local models: S4-F6-T2, S4-F6-T3, and S4-F6-T6.
- Usage: S4-F7-T2, then S4-F7-T3 and S4-F7-T4.
- Planning: S4-F9-T2 and S4-F9-T4; S4-F9-T3 follows parsing.
- Mobile: S4-F10-T2, then S4-F10-T3 and S4-F10-T4.

### Wave 3 — Add guarded mutation and user surfaces

- S4-F1-T5 and S4-F1-T6.
- S4-F2-T5.
- S4-F3-T7 and S4-F3-T8, then S4-F3-T5 and S4-F3-T9.
- S4-F4-T4 and S4-F4-T5, then the cross-feature operation workspace S4-F4-T6.
- S4-F5-T5, S4-F5-T6, and then S4-F5-T7.
- S4-F6-T4, then S4-F6-T5.
- S4-F7-T5 and S4-F7-T6.
- S4-F9-T5 and S4-F9-T6, then S4-F9-T7.
- S4-F10-T5.

### Wave 4 — Integrate local models and portable state

- S4-F6-T7 binds local runs to the completed S4-F3 policy and S4-F4 pane seams.
- S4-F8-T1 and S4-F8-T2 establish bundle scope and the secrets boundary.
- S4-F8-T3 exports stable feature data and usage reports.
- S4-F8-T4 and S4-F8-T5 implement staged import and rollback.
- S4-F8-T6 and S4-F8-T7 add explicit private git sync and its UI.

### Wave 5 — Complete the mobile control plane

- S4-F10-T6 binds only the action catalog approved by S4-F3-T5 and the bounded
  automation execution contract from S4-F5-T6.
- S4-F10-T7 adds approval decisions and best-effort notifications after
  authenticated state, UI, and controls exist.
- User-owned VPN or tunnel access may expose the LAN bridge, but Flapstack does
  not provide a relay or open a public listener.

### Wave 6 — Close each feature independently

- S4-F1-T7, S4-F2-T6, S4-F3-T10, S4-F4-T7, S4-F5-T8, S4-F6-T8,
  S4-F7-T7, S4-F8-T8, S4-F9-T8, and S4-F10-T8.
- A feature can close only when its focused tests, documentation, recovery or
  rollback path, required live walkthrough, and feature matrix rows are truthful.

### Wave 7 — Integrated Stage 4 exit

- Exercise all ten features in one project using
  `docs/stage4-full-feature-test-matrix.md`.
- Run Node 22 `npm run check` and strict validation for all ten OpenSpec changes.
- Start live development only with `npm run dev`; run `npm run dev:verify`
  before claiming the Stage 4 checkout and `Flapstack Dev` profile are running.
- Use `npm run package:preview:mac` for packaged macOS proof. Keep Windows,
  Linux, credentialed-provider, and unavailable-device rows open until observed.
- Perform final security, migration, accessibility, recovery, and documentation
  review. Stage 4 exits only when all 77 tasks and the integrated matrix are closed.

## Fixed product decisions

- Automation runs only while Flapstack is open; one missed schedule may catch
  up on restart. Agent-created automation remains disabled until approved.
- Ollama loopback is the first local provider. Read-only tools precede project
  writes, shell/git, and network tiers; there is no hidden cloud fallback.
- Raw usage facts remain authoritative. Cached rollups are rebuildable, and
  provider totals are never silently attributed to individual runs.
- Portability uses a versioned `.flapstack-export/` directory bundle. Secrets
  are excluded; import is dry-run, staged, transactional, and recoverable.
- Kanban cards are real tasks with fixed backlog/planned/in-progress/review/done
  states. Promotion creates exactly one task and one chat, never an automatic run.
- The mobile companion is a default-off LAN HTTPS PWA with one-time pairing,
  revocable device credentials, desktop authority, and read-only offline state.
- Multi-agent orchestration defaults to Flapstack's deterministic `workflow`
  engine. Codex V2 task-tree mode is capability-gated; Codex V1 is advanced legacy
  compatibility. Engine choice is snapshotted per orchestration and never falls
  back silently.
- Every new orchestration owns one task-scoped saved operation workspace. Agent
  chats join its roster as they materialize; the four-visible-chat cap still holds.
- Agent capability profiles, presentation personalities, workflow templates, and
  runtime snapshots are separate concepts. The profile/personality product stays
  behind its research gate until its trust, precedence, memory, and evaluation
  decisions are promoted.

## Parked after Stage 4

There is no Stage 5 roadmap. Screenshot/visual-context tooling remains the only
named parking-lot item and has no implementation task until deliberately promoted.

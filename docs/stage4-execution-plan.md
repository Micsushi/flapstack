# Stage 4 Execution Plan

Stage 4 is the prerequisite operating-environment stage for Stage 5. Its eleven
feature boards contain 87 independently pick-up-able tasks. This document orders those boards without
duplicating task state; the checkbox in each OpenSpec `tasks.md` is authoritative.

## Baseline and entry gate

- Planning branch: `codex/stage4-features`, created from `main` at `25536be`.
- Agent Runtime planning targets the clean Stage 3 `stage3-final` tag at
  `a674784`. Stage 4 must sync that baseline before S4-F11 implementation.
- Integrated implementation starts only after the remaining Stage 3
  live/provider/package evidence is closed or recorded as exact blockers.
- Stage 4 remains local-first. No hosted Flapstack service, hosted sync, or
  arbitrary control of first-party vendor sessions enters this stage.

## Pickup contract

Each task owns one bounded acceptance result and includes its parent, outcome,
scope, out-of-scope boundary, verification, blockers, downstream blocks, and
code context. Tasks are checkpoints inside a feature lane, not separate worker
or worktree boundaries. One feature owner keeps one worktree until every
available task in that feature is implemented and the coordinator accepts the
feature-wide gate.

Before work:

1. Start from the latest Stage 4 integration commit in a clean feature
   worktree.
2. Read the feature proposal, design, delta spec, and the complete feature task
   board.
3. Confirm blockers before each task checkpoint. Continue every unblocked task
   in the feature instead of stopping at the first blocked checkpoint.
4. Record any discovered contract conflict in the feature board before coding.

During and after work:

1. Keep changes inside the selected task's scope and named integration seams.
2. Add the focused tests named by each task while coding.
3. Run the smallest relevant checks during implementation, then one broad
   feature gate after the feature code path is complete. Leave live, package,
   provider, and OS evidence open until observed.
4. Update authoritative task checkboxes and evidence only after their acceptance
   is real.
5. Release the feature owner after code/headless acceptance. UI-only evidence
   remains named and unchecked for the consolidated Stage 4 UI sweep instead of
   holding the worker slot.

Suggested branch names use `codex/s4-fN-feature-name`. One feature branch should
contain one reviewable feature outcome with small internal checkpoint commits.

## Authoritative feature boards

| Feature                      | Tasks | Board                                                        | Independent outcome                                                         |
| ---------------------------- | ----: | ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| S4-F1 Unified skills/hooks   |     7 | `openspec/changes/add-unified-skills-hooks-manager/tasks.md` | Native extension inventory, policy, safe editing, sharing, and hook control |
| S4-F2 Knowledge vaults       |     6 | `openspec/changes/add-project-knowledge-vaults/tasks.md`     | Typed project knowledge with explicit context and safe agent operations     |
| S4-F3 Multi-agent operations |    10 | `openspec/changes/extend-multi-agent-operations/tasks.md`    | Selectable engines, workflows, fleet, reasoning, policy, and safe controls  |
| S4-F4 Saved workspaces       |     7 | `openspec/changes/add-saved-workspaces/tasks.md`             | Manual and orchestration-owned multi-pane workspaces across windows         |
| S4-F5 Automation             |     8 | `openspec/changes/add-local-automation-scheduler/tasks.md`   | Default-safe in-app scheduling, triggers, approvals, history, and kill      |
| S4-F6 Local models           |     8 | `openspec/changes/add-local-model-harness/tasks.md`          | Ollama-first app-owned agent loop with capability-gated tools               |
| S4-F7 Usage/limits           |     7 | `openspec/changes/extend-advanced-usage-limits/tasks.md`     | Reconciled attribution, forecasting, budgets, alerts, and export            |
| S4-F8 Portability/sync       |     8 | `openspec/changes/add-portable-import-export-sync/tasks.md`  | Versioned selective bundles and explicit user-owned private git sync        |
| S4-F9 Plan/Kanban            |     8 | `openspec/changes/add-plan-kanban-workflow/tasks.md`         | Read-only plans, real task cards, and approval-gated proposals              |
| S4-F11 Agent runtimes        |    10 | `openspec/changes/add-agent-runtimes/tasks.md`               | Native Codex/Claude behavior plus stable Flapstack Native compatibility     |
| S4-F12 Agent profiles        |     8 | `openspec/changes/add-agent-profiles-personalities/tasks.md` | Reusable named agents for workflows and standalone specialist launches      |

## Dependency waves

Waves are readiness groups, not permission to bypass each task's exact blockers.
Tasks inside one wave can run in parallel when they do not share a migration,
schema, or generated-file seam.

### Wave 0 — Close the Stage 3 entry gate

- Finish or explicitly block the remaining Stage 3 live, provider, platform,
  package, approval/audit, orchestration, and extension evidence.
- Freeze the shipped contracts consumed by S4-F1-T1, S4-F3-T1, S4-F5-T1,
  S4-F6-T1 and S4-F11-T1.

### Wave 1 — Establish feature contracts and additive schemas

- S4-F1-T1, S4-F2-T1, S4-F3-T1, S4-F4-T1, S4-F5-T1, S4-F6-T1,
  S4-F7-T1, S4-F9-T1, and S4-F11-T1; S4-F11-T2 follows
  S4-F11-T1, then S4-F3-T6 follows S4-F3-T1 and S4-F11-T2.
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
- Runtimes: S4-F11-T3 establishes ordered activity after the shared contract.
- Profiles: S4-F12-T1 performs the blocking OMO/ECC product-decision pass after
  S4-F3-T6 and S4-F11-T1; S4-F12-T2 follows the resolved contract.

### Wave 3 — Add guarded mutation and user surfaces

- S4-F1-T5 and S4-F1-T6.
- S4-F2-T5.
- Runtimes: S4-F11-T4, S4-F11-T5, and S4-F11-T6 run in parallel with exclusive
  provider lanes; S4-F11-T7 and S4-F11-T8 follow. S4-F11-T9 alone wires the
  central registry and orchestration-worker launch seam after S4-F3-T6.
- S4-F3-T7 and S4-F3-T8 follow S4-F11-T9, then S4-F3-T5 and S4-F3-T9.
- S4-F4-T4 and S4-F4-T5, then the cross-feature operation workspace S4-F4-T6.
- S4-F5-T5, S4-F5-T6, and then S4-F5-T7.
- S4-F6-T4, then S4-F6-T5.
- S4-F7-T5 and S4-F7-T6.
- S4-F9-T5 and S4-F9-T6, then S4-F9-T7.
- Profiles: S4-F12-T3 and S4-F12-T4 establish trusted local storage and Profile
  Studio after the decision and schema gates.

### Wave 4 — Integrate local models and portable state

- S4-F6-T7 binds local runs to the completed S4-F3 policy and S4-F4 pane seams.
- S4-F8-T1 and S4-F8-T2 establish bundle scope and the secrets boundary.
- S4-F8-T3 exports stable feature data and usage reports.
- S4-F8-T4 and S4-F8-T5 implement staged import and rollback.
- S4-F8-T6 and S4-F8-T7 add explicit private git sync and its UI.
- S4-F12-T5 binds exact profile versions to completed deterministic workflows
  after S4-F11-T9 exposes the worker Runtime seam;
  S4-F12-T6 adds standalone named-agent launch after runtime/workspace seams exist.

### Wave 5 — Complete agent profiles

- S4-F12-T7 promotes only starter agent types that pass the approved capability,
  safety, prompt-injection, and cross-runtime evaluation gates.

### Wave 6 — Close each feature's code and headless acceptance

- S4-F1-T7, S4-F2-T6, S4-F3-T10, S4-F4-T7, S4-F5-T8, S4-F6-T8,
  S4-F7-T7, S4-F8-T8, S4-F9-T8, S4-F11-T10, and S4-F12-T8.
- A feature's code packet can close when focused tests, documentation, recovery
  or rollback, and headless evidence pass. Required visual or interactive rows
  remain named and unchecked for Wave 7.

### Wave 7 — Integrated Stage 4 exit

- Exercise all eleven features in one project using
  `docs/stage4-full-feature-test-matrix.md`.
- Run one consolidated unlocked-Mac UI, accessibility, multi-window, and direct
  interaction sweep for every deferred visual row.
- Run Node 22 `npm run check` and strict validation for all eleven OpenSpec changes.
- Start live development only with `npm run dev`; run `npm run dev:verify`
  before claiming the Stage 4 checkout and `Flapstack Dev` profile are running.
- Use `npm run package:preview:mac` for packaged macOS proof. Keep Windows,
  Linux, credentialed-provider, and unavailable-device rows open until observed.
- Perform final security, migration, accessibility, recovery, and documentation
  review. Stage 4 exits only when all 87 tasks and the integrated matrix are closed.

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
- Multi-agent orchestration defaults to Flapstack's deterministic `workflow`
  engine. Codex V2 task-tree mode is capability-gated; Codex V1 is advanced legacy
  compatibility. Engine choice is snapshotted per orchestration and never falls
  back silently.
- Every new orchestration owns one task-scoped saved operation workspace. Agent
  chats join its roster as they materialize; the four-visible-chat cap still holds.
- Agent capability profiles, presentation personalities, workflow bindings, and
  runtime snapshots are separate concepts. S4-F12-T1 is a blocking research gate;
  later F12 tasks add user-defined profiles, workflow binding, standalone named
  agents, Profile Studio, and evaluated starter types without allowing personality
  to widen authority.
- Agent Runtime is independent from coordination engine. Automatic resolution is
  Codex harness -> Codex, Claude Code harness -> Claude Code, and generic harness
  -> Flapstack Native; chat, project-per-harness, and global-per-harness overrides
  are durable, capability-gated, and never silently downgraded.

## Stage 5 boundary

Mobile control, screenshot/visual-context tooling, terminal-grid/swarm views,
onboarding, reusable personalities, product polish, performance, organization
usage, and public distribution are promoted into Stage 5. They remain outside
Stage 4 acceptance. See docs/stage5-execution-plan.md.

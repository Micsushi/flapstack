# S4-F9 — Plan and Kanban Views

Reconciled 2026-08-05: every `T2-core` task below is accepted. Dated partial
evidence remains historical; optional capability certification stays in the
Stage 4 matrix.

### S4-F9-T1 — Add task workflow and proposal contracts

- Evidence class: `T2-core`.
- [x] Completion: acceptance and verification passed
- Evidence: Node 22 `npm test -- plan-kanban-schema` (4 tests) and `npm test -- stage3-migration-rebase` (7 tests) pass; `npm run ts:check` and focused ESLint pass; strict OpenSpec validation passes.
- Parent: Project Flapstack / Stage S4 / Feature S4-F9
- Outcome: Tasks have canonical board status/order/version and AI proposals have inert durable identity.
- Scope: Task status migration; order/version/source provenance fields; `task_proposals` schema; proposal status/version; DTOs; indexes; prior-schema fixtures.
- Out of scope: Plan parsing, UI, task/chat creation transaction.
- Acceptance: `active` maps to `in-progress`; invalid transitions/proposals fail; existing task/chat identity is unchanged.
- Verification: `npm test -- plan-kanban-schema` plus supported prior-schema migration fixtures.
- Blocked by: Stage 3 task/chat baseline
- Blocks: S4-F9-T2, S4-F9-T4, S4-F9-T5, S4-F9-T6, S4-F9-T7
- Context: tasks/chats schema, current Kanban card/status mapping, task router.

### S4-F9-T2 — Implement plan source discovery and parsing

- Evidence class: `T2-core`.
- [x] Completion: acceptance and verification passed
- Evidence: Node 22 focused plan-source, plan-kanban, project-vault, and Stage 3 migration suites pass 33 tests across 5 files; `npm run ts:check`, focused ESLint/Prettier, and strict OpenSpec validation pass.
- Parent: Project Flapstack / Stage S4 / Feature S4-F9
- Outcome: Registered projects expose stable read-only candidates from OpenSpec and selected Markdown.
- Scope: Source registry/config; registered-root/path safety; OpenSpec proposal/spec/tasks parser; Markdown heading/checklist parser; source fingerprint; stable candidate IDs; parse limitations; refresh watcher.
- Out of scope: Editing plans and creating tasks.
- Acceptance: Escaped paths fail; malformed sources degrade with errors; unchanged sources keep candidate IDs; changed sources become stale.
- Verification: `npm test -- plan-source-reader` with OpenSpec, Markdown, malformed, symlink, rename, fingerprint, and watcher fixtures.
- Blocked by: S4-F9-T1
- Blocks: S4-F9-T3, S4-F9-T5, S4-F9-T7
- Context: OpenSpec layout, file viewer, registered roots, file-change watcher.

### S4-F9-T3 — Build the read-only Plan view

- Evidence class: `T2-core`.
- [x] Completion: acceptance and verification passed
- Evidence: Tier 1 code-ready/Tier 2 live-verification-remaining. The production Plan route and read-only
  renderer remain wired; the Node 22 F9 headless gate passes source, selector/reducer/service,
  renderer, stale, and malformed-state coverage. The live OpenSpec/Markdown and accessibility
  walkthrough remains unverified, so completion stays open.
- Parent: Project Flapstack / Stage S4 / Feature S4-F9
- Outcome: Users browse stage/feature/task plan hierarchy and distinguish proposed, active, built, stale, and malformed sources.
- Scope: Project Plan navigation; source selector; hierarchy/requirements/task rendering; status/limitation badges; search/filter; source open; candidate promotion affordance; progress capsule; accessibility.
- Out of scope: Inline plan editing and Kanban task mutation.
- Acceptance: Plan content remains read-only; source/path/status is visible; stale/parse errors do not masquerade as current plans.
- Verification: `npm test -- plan-view` plus accessibility and live OpenSpec/Markdown walkthrough.
- Blocked by: S4-F9-T2
- Blocks: S4-F9-T5, S4-F9-T8
- Context: agent plan sidebar, details Plan section, file viewer, progress capsule design.

### S4-F9-T4 — Replace chat-derived Kanban with real task cards

- Evidence class: `T2-core`.
- [x] Completion: acceptance and verification passed
- Evidence (code-ready; UI proof pending): Node 22
  `npx vitest run tests/task-kanban.test.ts tests/plan-kanban-schema.test.ts` passes 10 focused
  service/schema/selector/keyboard/accessibility tests; focused ESLint/Prettier and strict
  OpenSpec validation pass. A full TypeScript pass succeeded before final polling/invalidation
  edits; its final rerun was stopped without errors after 12 minutes of ten-worktree TypeScript
  contention. On 2026-07-14, `npm run dev:verify` proved the exact isolated checkout and
  `Flapstack Dev`; authenticated app-control created and listed five real task fixtures and one
  linked task chat. The Mac was locked, so real task navigation, drag/drop, keyboard,
  screen-reader, stale/error, and UI-state walkthroughs remain unverified.
  The final F9 audit also wired the durable task board into the production **Tasks** route and
  added a route regression; live route proof remains open.
- Parent: Project Flapstack / Stage S4 / Feature S4-F9
- Outcome: Project Kanban lists and moves durable tasks in fixed columns.
- Scope: Task board query; backlog/planned/in-progress/review/done columns; ordering/rebalance; versioned move; filters; archive/done; card task/chat/run summaries; keyboard drag alternative; accessibility.
- Out of scope: Plan parsing, AI proposals, and automatic run launch.
- Acceptance: Every normal card maps to one task; stale moves fail/refresh; task chats/runs remain linked; archived tasks are excluded by default.
- Verification: `npm test -- task-kanban` with ordering, rebalance, concurrent windows, archive, filter, keyboard, and accessibility cases.
- Blocked by: S4-F9-T1
- Blocks: S4-F9-T5, S4-F9-T6, S4-F9-T7, S4-F9-T8
- Context: inherited Kanban components, tasks router, chats/runs summaries.

### S4-F9-T5 — Add idempotent plan-candidate promotion

- Evidence class: `T2-core`.
- [x] Completion: acceptance and verification passed
- Evidence: Tier 1 code-ready/Tier 2 live-verification-remaining. Node 22 focused
  `plan-task-promotion`, schema, source-reader, Plan-view, and task-Kanban tests pass 29 cases;
  focused ESLint, Prettier, full strict TypeScript, and strict OpenSpec validation pass. Live UI
  confirmation, navigation, accessibility, and stale-error walkthroughs remain prohibited and
  unverified, so completion stays open.
- Parent: Project Flapstack / Stage S4 / Feature S4-F9
- Outcome: One confirmed candidate creates exactly one task and one seeded chat without a run.
- Scope: Preview DTO; project/task fields; status selection; permission/worktree defaults; source fingerprint precondition; idempotency key; transaction; seed message; navigation; rollback.
- Out of scope: AI proposal approval and automatic agent execution.
- Acceptance: Duplicate confirm creates one pair; stale source stops; failure rolls back both; new chat is idle and contains candidate context/acceptance.
- Verification: `npm test -- plan-task-promotion` with duplicate, stale, permission/worktree, DB fault, rollback, and no-run assertions.
- Blocked by: S4-F9-T1, S4-F9-T2, S4-F9-T3, S4-F9-T4
- Blocks: S4-F9-T7, S4-F9-T8
- Context: task/chat create services, copy-on-create defaults, chat seed messages, navigation invalidation.

### S4-F9-T6 — Add approval-gated AI task proposals

- Evidence class: `T2-core`.
- [x] Completion: acceptance and verification passed
- Evidence: Tier 1 code-ready/Tier 2 live-verification-remaining. Node 22 focused
  `ai-task-proposals`, task/plan Kanban, MCP gate/audit/transport, and invalidation suites pass
  72 tests across 12 files; repo-wide ESLint, Prettier check, and strict TypeScript pass;
  `npm run build` and strict OpenSpec validation pass. Live proposal-tray review, exact-preview,
  capped-batch, denial, accessibility, and cross-window walkthroughs remain prohibited and
  unverified, so completion and S4-PK03 stay open.
- Parent: Project Flapstack / Stage S4 / Feature S4-F9
- Outcome: Agents propose bounded task cards without creating live work until approval.
- Scope: MCP propose/list/read/update/cancel; caller scope; proposal tray; exact task/chat preview; single and capped batch approval; denial/archive; audit; idempotency; rate/count limits.
- Out of scope: Automatic approval and automatic run launch.
- Acceptance: Proposal creates no task/chat; approval creates exact reviewed state; denial is terminal; stale caller/target/batch overflow fails closed.
- Verification: `npm test -- ai-task-proposals` covering identity, scope, approval, batch cap, denial, idempotency, audit, and no-run cases.
- Blocked by: S4-F9-T1, S4-F9-T4 and Stage 3 MCP gate/audit
- Blocks: S4-F9-T7, S4-F9-T8
- Context: MCP approval lifecycle, automation draft pattern, task/chat transaction.

### S4-F9-T7 — Add provenance, divergence, and cross-window consistency

- Evidence class: `T2-core`.
- [x] Completion: acceptance and verification passed
- Evidence: Tier 1 code-ready/Tier 2 live-verification-remaining. Node 22 full headless F9 regression passes
  101 tests across 16 suites, including source edits and recovery, linked task/proposal
  comparisons, stale two-window moves, promotion deduplication, proposal decision races,
  versioned rebalance, production route wiring, audit, and renderer invalidation.
  Full strict TypeScript, repo-wide ESLint, focused Prettier, production build, `git diff --check`,
  and strict OpenSpec validation pass. Live Plan/Kanban compare UI, accessibility, and real
  multi-window refresh walkthroughs remain prohibited and unverified, so completion stays open.
- Parent: Project Flapstack / Stage S4 / Feature S4-F9
- Outcome: Plan sources, proposals, tasks, chats, and boards remain truthful after edits and concurrent actions.
- Scope: Source-task link query; fingerprint divergence; compare UI data; optimistic versions; renderer invalidation; board refresh; no silent reverse sync; move/promotion/proposal race handling.
- Out of scope: Writing changes back into plan source files.
- Acceptance: Later plan edits never overwrite tasks; every race resolves to one durable outcome; other windows refresh affected project/task/proposal queries.
- Verification: `npm test -- plan-kanban-consistency` with source edit, two-window moves, promotion race, proposal race, and invalidation fixtures.
- Blocked by: S4-F9-T1, S4-F9-T2, S4-F9-T4, S4-F9-T5, S4-F9-T6
- Blocks: S4-F9-T8
- Context: product invalidation bridge, React Query families, diff viewer.

### S4-F9-T8 — Close Plan and Kanban acceptance

- Evidence class: `T2-core`.
- [x] Completion: acceptance and verification passed
- Evidence: Tier 1 code-ready/Tier 2 live-verification-remaining. The Node 22 feature-wide F9 headless gate
  passes 101 tests across 16 suites. Production Tasks routing, serialized source recovery,
  versioned reorder conflicts, and operator docs are covered. Full ESLint, strict TypeScript,
  touched Prettier, production build, strict OpenSpec, and diff checks pass. The canonical
  `npm run check` stops at four untouched baseline Drizzle snapshots
  (`0031_snapshot.json`-`0034_snapshot.json`) that fail repository Prettier.
  Live Plan/Kanban UI, automated semantic/accessibility checks, real
  multi-window, and `npm run dev:verify` remain open, so completion and
  S4-PK01-S4-PK03 stay open. Packaged-preview certification remains the
  separate S4-I03 release gate.
- Parent: Project Flapstack / Stage S4 / Feature S4-F9
- Outcome: Plan browsing, real-task Kanban, promotion, AI approval, and divergence pass integrated evidence.
- Scope: Full gate; matrix S4-PK01–S4-PK03; migrations; two-window races;
  OpenSpec/Markdown; proposal approve/deny; no auto-run; and docs.
- Out of scope: Editable plan files and configurable columns.
- Acceptance: One candidate and one AI proposal each produce exactly one reviewed task/chat; all cards are tasks; stale/conflict cases remain honest.
- Verification: Node 22 `npm run check`, strict OpenSpec,
  `npm run dev:verify`, and production-path Plan/Kanban MCP/live matrix
  evidence. Packaged macOS evidence remains the separate S4-I03 release gate.
- Blocked by: S4-F9-T3, S4-F9-T4, S4-F9-T5, S4-F9-T6, S4-F9-T7
- Blocks: Stage S4 integrated exit
- Context: `docs/stage4-full-feature-test-matrix.md` and Stage 4 execution plan.

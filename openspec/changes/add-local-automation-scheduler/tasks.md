# S4-F5 — Automation and Scheduler

### S4-F5-T1 — Add automation contracts and durable schema

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F5
- Outcome: Typed local automation, trigger, occurrence, execution, lease, retry, budget, and inbox records exist.
- Scope: Shared Zod/TypeScript DTOs; additive Drizzle schema/migration; enabled/approval provenance; indexes; prior-schema fixtures.
- Out of scope: Scheduler timers and renderer UI.
- Acceptance: Invalid trigger/target/permission/budget combinations fail validation; existing databases migrate with drafts disabled.
- Verification: `npm test -- automation-schema` plus migration fixtures from the last supported Stage 3 schema.
- Blocked by: Stage 3 release baseline
- Blocks: S4-F5-T2, S4-F5-T5, S4-F5-T7
- Context: `src/main/lib/trpc/routers/automations.ts`, MCP automation draft, run/orchestration DTOs, DB schema.

### S4-F5-T2 — Implement the leased main-process scheduler

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F5
- Outcome: Due occurrences are leased and dispatched once with startup recovery.
- Scope: Scheduler service, timer lifecycle, transactional lease/CAS, next-fire calculation, one-catch-up policy, clock-change handling, startup/shutdown reconciliation.
- Out of scope: Trigger-specific event collection and run execution.
- Acceptance: Concurrent drains never double-lease; completed occurrences never replay; restart resolves expired leases truthfully.
- Verification: `npm test -- automation-scheduler` with fake clock, concurrent drains, crash/restart, clock jump, and missed-run fixtures.
- Blocked by: S4-F5-T1
- Blocks: S4-F5-T3, S4-F5-T4, S4-F5-T6
- Context: usage scheduler patterns, orchestration lease logic, Electron startup/shutdown.

### S4-F5-T3 — Add manual, schedule, and run-complete triggers

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F5
- Outcome: Three deterministic trigger sources create deduplicated occurrences.
- Scope: Manual fire, cron parser/timezone, next-fire calculation, run-terminal event bridge, target filters, occurrence dedupe key, one-catch-up behavior.
- Out of scope: File watching and execution launch.
- Acceptance: DST/timezone and repeated run events produce expected unique occurrences; archived targets do not trigger.
- Verification: `npm test -- automation-triggers` with DST, timezone, duplicate event, stale target, and catch-up fixtures.
- Blocked by: S4-F5-T2
- Blocks: S4-F5-T7, S4-F5-T8
- Context: scheduler service, run completion persistence/invalidation, task/chat scopes.

### S4-F5-T4 — Add scoped file-change triggers

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F5
- Outcome: Registered project/worktree changes create bounded coalesced occurrences.
- Scope: Registered-root watcher, include/exclude globs, debounce/coalescing, symlink defense, watcher restart, generated/output ignore defaults.
- Out of scope: Watching arbitrary filesystem paths or running the automation.
- Acceptance: Escaped paths fail closed; event storms create one occurrence; removed roots stop watching; restart does not leak watchers.
- Verification: `npm test -- automation-file-trigger` with symlink, storm, ignore, root replacement, and restart fixtures.
- Blocked by: S4-F5-T2
- Blocks: S4-F5-T7, S4-F5-T8
- Context: git watcher, registered filesystem roots, path safety, file-change listener.

### S4-F5-T5 — Add approval-gated CRUD and MCP management

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F5
- Outcome: Users and authorized agents manage automations without bypassing approval or scope.
- Scope: CRUD router/service, draft review, enable/disable, authority/budget impact classification, MCP list/read/create-draft/update/enable controls, approval, audit, invalidation.
- Out of scope: Scheduler dispatch and UI layout.
- Acceptance: Agent-created records remain disabled; enabling or expanding authority requires approval; stale/idempotent requests are safe.
- Verification: `npm test -- automation-control` covering caller identity, scope, approval, denial, timeout, audit redaction, and invalidation.
- Blocked by: S4-F5-T1 and Stage 3 MCP gate/audit
- Blocks: S4-F5-T6, S4-F5-T7, S4-F5-T8
- Context: MCP mutation service/registry, approval coordinator, audit storage, automation scaffold router.

### S4-F5-T6 — Execute bounded runs with retry, budgets, and kill

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F5
- Outcome: A leased occurrence launches one normal Flapstack run and reaches a truthful terminal state.
- Scope: Shared target resolution, permission/worktree snapshot, dry-run resolver, run/orchestration launch, concurrency=1 default, retry/deadline, token/cost/time budgets, pause/kill, checkpoints/manifests/usage, result summary.
- Out of scope: Renderer UI and OS-level scheduling.
- Acceptance: Dry-run launches nothing; retries are bounded; kill prevents future retry; every run retains normal evidence and authority snapshots.
- Verification: `npm test -- automation-execution` with success, deny, crash, retry, budget, kill, dry-run, and stale-target cases.
- Blocked by: S4-F5-T2, S4-F5-T5
- Blocks: S4-F5-T7, S4-F5-T8, S4-F10-T6
- Context: shared run launch, orchestration service, checkpoints, usage capture, permission resolver.

### S4-F5-T7 — Build local automation management, history, and inbox UI

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F5
- Outcome: Users create, review, dry-run, enable, pause, kill, and inspect local automations.
- Scope: Replace hosted API calls; list/detail/editor; trigger/target/authority/budget preview; approval state; execution history; unread inbox; notifications; closed-app limitation; keyboard/accessibility.
- Out of scope: New visual design system or hosted templates.
- Acceptance: Every mutating action shows exact impact; disabled/draft/error states are honest; history and inbox navigate to real task/chat/run evidence.
- Verification: `npm test -- automation-ui` plus accessibility tests and live Dev walkthrough.
- Blocked by: S4-F5-T1, S4-F5-T3, S4-F5-T4, S4-F5-T5, S4-F5-T6
- Blocks: S4-F5-T8
- Context: inherited automation/inbox components, Settings visibility, desktop notifications.

### S4-F5-T8 — Close automation acceptance

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F5
- Outcome: Local automation passes automated, restart, live, and packaged evidence.
- Scope: Full gate; Stage 4 matrix S4-AU01–S4-AU03; schedule/manual/run/file triggers; approval/deny; dry-run; retry/budget/kill; restart; docs; package preview.
- Out of scope: Running while the app is closed or hosted scheduling.
- Acceptance: One approved automation completes with full evidence; unsafe and closed-app cases remain explicit; no duplicate execution occurs.
- Verification: Node 22 `npm run check`, strict OpenSpec, `npm run dev:verify`, live matrix, and `npm run package:preview:mac`.
- Blocked by: S4-F5-T3, S4-F5-T4, S4-F5-T5, S4-F5-T6, S4-F5-T7
- Blocks: Stage S4 integrated exit
- Context: `docs/stage4-full-feature-test-matrix.md` and Stage 4 execution plan.

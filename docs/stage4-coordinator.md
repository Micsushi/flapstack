# Stage 4 Autonomous Coordinator

This document defines the execution policy for finishing Stage 4. The eleven
OpenSpec `tasks.md` files remain the only task-status authority. This document
does not duplicate their checkboxes.

## Objective

Implement every Stage 4 feature on `codex/stage4-features`, verify every claim
with the strongest available evidence, and close the integrated Stage 4 matrix
without touching `main` or Stage 3 worktrees.

## Agent Budget

- One coordinator owns dispatch, dependency checks, feature review,
  integration, and the final gate.
- Run up to five visible feature-owner workers beside the coordinator.
- One Stage 4 feature per worker and one long-lived isolated worktree per
  feature. OpenSpec tasks remain acceptance checkpoints, not worktree or agent
  boundaries.
- Refill a worker slot after the coordinator accepts the feature's code and
  headless evidence. An exact UI-only external blocker is recorded and deferred
  to the final Stage 4 UI sweep; it does not hold the worker slot.
- Do not create hidden subagents. Use visible user-owned Codex tasks.

## Dispatch Loop

1. Read all eleven authoritative OpenSpec task boards.
2. Reconcile checkbox state with committed code and recorded evidence.
3. Select dependency-ready features, then assign one owner every remaining task
   in that feature.
4. Avoid concurrent ownership of migrations, shared schemas, central runtime
   registry, orchestration dispatch, or the same renderer/service files.
5. Start feature owners from the latest `codex/stage4-features` head and keep
   that worktree until the feature closes.
6. Workers implement the full feature, using task boundaries only as local
   checkpoints. They report exact changed files, focused checks, open evidence
   classes, and dependency changes.
7. A worker with an uncommitted diff must pause before finalizing. Visible Codex
   tasks may auto-remove their worktrees after completion, so the coordinator
   reviews and preserves the complete feature diff before releasing the worker.
8. Review the complete feature diff. Reject stale, overlapping, unverified, or
   scope-expanded work and return concrete fixes to the same feature owner.
9. Run one conflict-sensitive feature gate and update the authoritative task
   board. Preserve and integrate the code-accepted packet when current Git
   authority allows it, while keeping UI-dependent completion unchecked.
10. Recompute dependencies and immediately assign the next feature to the freed
    worker slot.

## YOLO Mode

- Ordinary product and implementation decisions do not wait for user input.
- Implement backend, renderer, accessibility, migration, provider, recovery,
  documentation, and test code paths as specified.
- Missing Stage 3 live evidence does not block Stage 4 code when the required
  current interface exists.
- Never fabricate live, provider, package, OS, or device evidence.
- Keep completion unchecked when required acceptance has not been observed.

## Verification Order

Use Node 22. Prefer the smallest proof that exercises the changed seam. Do not
repeat broad gates after every task checkpoint:

1. Pure unit, service, reducer, schema, migration, and fixture tests.
2. Authenticated Flapstack test-control or app-control MCP for application
   behavior that does not require visual observation.
3. Focused TypeScript, ESLint, Prettier, production build, and strict OpenSpec.
4. One feature-wide gate after the feature code path is complete.
5. Full `npm run check` at dependency-integration milestones and Stage 4 exit.
6. One consolidated real-UI walkthrough after all Stage 4 feature code is
   accepted. Run UI earlier only when a concrete interface contract cannot be
   resolved through component tests or authenticated app-control evidence.

Respect `/tmp/flapstack-heavy-job.lock`. Never steal or bypass it. When held,
run focused direct checks and retry the full gate later.

## UI Lease

Only one agent may run or control Flapstack UI at a time.

1. Run `npm run ui:lock:status`.
2. Acquire the lease with `npm run ui:lock -- <S4-task-id>` and keep that
   process alive during UI work, or wrap the required UI command with the lock.
3. Start live development only with `npm run dev`.
4. Before any live claim, run `npm run dev:verify` and prove the exact checkout
   plus `Flapstack Dev` profile.
5. Release the lease immediately after the required UI observation.

Electron, Playwright, Computer Use, package preview, and other focus-changing
UI operations all require the lease. Authenticated MCP and headless checks do
not. Never open a production `Flapstack.app` as a development target.

## Integration

- Integration destination: `codex/stage4-features` only.
- Preserve unrelated dirty files in the integration worktree.
- Recheck the integration head immediately before every integration action.
- Serialize migration numbers and regenerate snapshots/journal entries from the
  latest accepted integration state.
- Run focused feature checks after integration and update task evidence
  truthfully.
- The current user directive authorizes committing each fully reviewed feature
  to `codex/stage4-features`. It does not authorize pushing or touching `main`.
- Never allow a dirty worker task to finalize before its reviewed changes are
  preserved; an uncommitted completed worktree is not durable evidence.
- Never push unless a current user message explicitly authorizes that push.
- Commits, branches, merges, rebases, cherry-picks, and ref movement remain
  subject to the current-message Git mutation gate.

## F11/F3 Runtime boundary

- Orchestration worker definitions may add only an optional
  `runtimePreference`; F3 scheduling and coordination engines remain
  provider-neutral.
- F11 worker materialization persists that preference on the chat, then creates
  the immutable run Runtime snapshot.
- `RuntimeLaunchCoordinator` alone owns adapter selection, capability probes,
  enable/disable state, and dispatch. Unavailable or incompatible choices fail
  with a typed reason and never silently fall back.
- F3 consumes only worker run/Runtime snapshots plus provider-neutral lifecycle
  and activity references. It must not select adapters, parse provider streams,
  or copy Runtime activity text.
- Any contract mismatch returns to the F11/F3 owners before either feature
  widens this seam.

## Review Rounds

After feature implementation, run fresh bounded reviews in this order:

1. Correctness, persistence, migration, concurrency, recovery, and stale state.
2. Security, permissions, path boundaries, secrets, audit, and denial paths.
3. Renderer behavior, accessibility, performance, cross-window invalidation,
   and limitation honesty.

Review fixes return through isolated task worktrees and the same verification
and integration rules.

## Exit

Stage 4 reaches implementation completion only when its 73
implementation-gating task checkboxes and all 52 `T2-core` rows in
`docs/stage4-full-feature-test-matrix.md` are closed with real evidence.
Provider, remote, platform, and device capabilities retain separate
certification status; the packaged macOS row remains a release gate. Tier 3
owner checks stay in the manual backlog unless explicitly labeled
`release-blocking`.

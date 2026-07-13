# S3-F17 Integrated Regression and Release Board

This board replaces former Stage 2 task `7.2` and owns all integrated/manual
Stage 3 regression and release authority. S3-F6-T4 and S3-F13-T4 remain their
feature-local closeout gates.

### S3-F17-T1 — Freeze the release manifest and unified evidence ledger

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / S3-F17 Integrated Regression and Release
- Outcome: One dependency-complete ledger maps every active requirement, feature
  exit, integrated regression, platform, and archive action to exact evidence.
- Scope: Inventory active changes/specs/tasks/routers/docs; reconcile prior
  Stage 2/3 manual matrices; define required/conditional rows, candidate header,
  isolation/cleanup, evidence reuse invalidation, pass/fail/block rules, skipped
  test routing, review findings, and archive order.
- Out of scope: Mark inherited evidence passed without exact-SHA applicability.
- Acceptance:
  - Every active normative scenario and feature exit maps to a stable row.
  - The dependency graph is acyclic and identifies S3-F6/F9/F10/F12/F13/F14/
    F15/F16 prerequisites.
  - Existing matrices are inputs, not competing completion boards.
  - Every row records exact candidate/environment/artifact and reversal steps.
- Verification: automated link/task-ID/dependency audit; strict validation of
  `validate-stage3-release`; manual coverage review.
- Blocked by: none.
- Blocks: S3-F17-T2, S3-F17-T3, S3-F17-T4, S3-F17-T5.
- Relevant context: all active `openspec/changes/**`, Stage 3 feature routers,
  existing Stage 2/3 test matrices and package/live-dev rules.

### S3-F17-T2 — Pass automated, migration, MCP, daemon, and package gates

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / S3-F17 Integrated Regression and Release
- Outcome: One frozen candidate passes all reproducible automated and package
  checks with migrations and skipped evidence accounted for.
- Scope: Run Node 22 full gate; strict-validate all changes; migrate seeded
  pre-Stage-3 databases; run security/concurrency/provider/reasoning/Voice/Usage
  focused suites; production and dev MCP SDK smoke; usage daemon smoke; build
  and package resource/ABI inspection; enumerate skips/warnings.
- Out of scope: Treat automation as replacement for provider-live or UI rows.
- Acceptance:
  - `npm run check` passes without weakened config or new unexplained skips.
  - Migration preserves old data and establishes safe defaults through current
    schema.
  - Production MCP and dev-test MCP remain separated and correctly gated.
  - Native/package resources and CLI/sidecar/STT paths match target architecture.
- Verification: exact command logs for Node 22 `npm run check`; all-change
  strict validation; migration suites; MCP SDK/proxy smoke;
  `npm run smoke:usage-daemon`; package inspection/smoke commands.
- Blocked by: S3-F17-T1, S3-F6-T4, S3-F13-T4, S3-F14-T5, S3-F15-T5,
  S3-F16-T5.
- Blocks: S3-F17-T3, S3-F17-T4, S3-F17-T5.
- Relevant context: package scripts, migration journal/snapshots, all feature
  focused suites, production/dev MCP boundaries.

### S3-F17-T3 — Pass isolated live-dev and packaged regression matrices

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / S3-F17 Integrated Regression and Release
- Outcome: Real UI, providers, services, persistence, restart, and failure paths
  agree across the integrated Stage 3 candidate.
- Scope: Verify dev identity; exercise MCP exposure/approval/audit/spawn/safety;
  Voice; secure credential add/restart/remove; all eligible permission modes;
  Cursor/OpenRouter/NanoGPT; Usage daemon/providers/alerts/dashboard; reasoning;
  Settings copy/search; auth failure/retry; stop/cancel; restart/recovery; package
  preview and platform rows; capture IDs and clean up.
- Out of scope: Use production profile/data, generic Flapstack app target, or
  infer an unavailable platform/provider result.
- Acceptance:
  - UI, runtime, SQLite, MCP/audit, provider, and evidence artifacts agree for
    every required row.
  - `npm run dev:verify` proves the Stage 3 checkout and `Flapstack Dev` profile.
  - Packaged macOS uses `npm run package:preview:mac` and `Flapstack Preview`;
    other platforms record equivalent package identity.
  - Failure, restart, redaction, focus, and cleanup observations pass.
- Verification: unified manual ledger; exact dev/package headers; screenshots,
  sanitized logs, SQLite queries, provider/run/audit IDs, process/service cleanup.
- Blocked by: S3-F17-T1, S3-F17-T2, S3-F9-T4, S3-F10-T4, S3-F12-T5,
  S3-F6-T4, S3-F13-T4.
- Blocks: S3-F17-T4, S3-F17-T5.
- Relevant context: feature exit evidence, `docs/stage3-headless-integration-audit.md`,
  provider/Usage/reasoning/Voice matrices, root live-dev rules.

### S3-F17-T4 — Run up to three independent review and repair rounds

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / S3-F17 Integrated Regression and Release
- Outcome: Independent review finds and resolves integration defects before the
  branch is handed to the user.
- Scope: For each round, run separate code correctness, security/permissions,
  data/migration/concurrency, UI/accessibility, package/platform, tests, and
  spec/task truth review; deduplicate findings; assign severity/disposition;
  fix accepted issues; rerun focused and full gates; record SHA and residual risk.
- Out of scope: Endless polish, unrelated refactors, or downgrade a required
  defect because the round cap was reached.
- Acceptance:
  - Each round has independent reviewer evidence and a stable finding ledger.
  - Every accepted required finding is fixed and verified on the resulting SHA.
  - A changed SHA reruns affected manual rows plus the full automated gate.
  - After at most three complete rounds, no required finding remains; otherwise
    S3-F17 stays blocked with exact findings.
- Verification: review/fix ledgers for rounds 1-3 as needed; focused commands;
  Node 22 `npm run check`; all-change strict validation; affected live/package
  reruns on final SHA.
- Blocked by: S3-F17-T1, S3-F17-T2, S3-F17-T3.
- Blocks: S3-F17-T5.
- Relevant context: final candidate diff, all active specs/tasks, security and
  migration boundaries, unified evidence ledger.

### S3-F17-T5 — Reconcile, archive, clean up, and hand off Stage 3

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / S3-F17 Integrated Regression and Release
- Outcome: The Stage 3 branch is truthful, archive-ready, cleanly tested, and
  ready for the user's squash-merge decision.
- Scope: Audit every checkbox against acceptance/evidence; correct specs/tasks/
  routers/docs; strict-validate all changes; archive completed OpenSpec changes
  in dependency order; rerun validation and release gate after archive; stop and
  remove test processes/services/exposure/credentials/data as scoped; produce
  exact-SHA handoff with limitations and residual blockers.
- Out of scope: Squash-merge, merge to `main`, push, publish, or delete user data.
- Acceptance:
  - All prerequisite feature exits and required integrated rows pass on final SHA.
  - No task is checked from intention, stale evidence, or a different SHA.
  - Active/archive specs, routers, docs, and implementation agree and strict
    validation passes after archival.
  - Test resources are cleaned up, `main` remains untouched, and the handoff
    clearly leaves squash-merge to the user.
- Verification: final evidence audit; all-change and post-archive strict
  validation; Node 22 `npm run check`; `git status --short --branch`;
  `git diff --check`; process/service/profile cleanup checks.
- Blocked by: S3-F17-T1, S3-F17-T2, S3-F17-T3, S3-F17-T4.
- Blocks: Stage 3 exit and user-owned squash merge to `main`.
- Relevant context: unified evidence/review ledgers, OpenSpec archive commands,
  final Stage 3 branch/working-tree status and release handoff.

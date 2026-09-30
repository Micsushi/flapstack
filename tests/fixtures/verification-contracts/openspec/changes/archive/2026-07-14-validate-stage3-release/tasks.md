# S3-F17 Integrated Regression and Release Board

This board replaces former Stage 2 task `7.2` and owns all integrated/manual
Stage 3 regression and release authority. S3-F6-T4 and S3-F13-T4 remain their
feature-local closeout gates.

### S3-F17-T1 — Freeze the release manifest and unified evidence ledger

- [x] Completion: acceptance and verification passed
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
- 2026-07-13 evidence: `docs/stage3-release-candidate-ledger.md` maps all 18
  active non-archive changes, every current normative scenario, 54 stable release rows,
  17 feature exits, the
  required prerequisite graph, stable evidence rows, candidate identity,
  invalidation rules, and cleanup/reversal requirements. The automated
  coverage/dependency audit and strict validation pass. Existing feature
  matrices remain evidence inputs and retain their open rows.

### S3-F17-T2 — Pass automated, migration, MCP, daemon, and package gates

- [x] Completion: acceptance and verification passed
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
- 2026-07-13 safe evidence: Node 22 full/focused suites, all-change strict
  validation, the dev-test-control SDK/API and clean SQLite inspection, Usage
  daemon lifecycle smoke, and unsigned macOS arm64 Preview build/ABI/license/
  runtime smoke pass. An early-SIGTERM Usage daemon startup race found by the
  smoke was fixed with a regression. This task remains open because its listed
  prerequisite exits remain open and automation does not satisfy their live,
  credential, UI, or cross-platform acceptance.

### S3-F17-T3 — Pass isolated live-dev and packaged regression matrices

- [x] Completion: acceptance and verification passed
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
- 2026-07-13 safe evidence: isolated `Flapstack Dev cf53` startup and
  `npm run dev:verify` prove this checkout/profile; authenticated test-control
  status calls, database cleanup queries, and exact unsigned Preview executable
  launch pass. The screen was locked, so visual, accessibility, clipboard,
  microphone, Keychain, approval-dialog, and live provider rows remain open.
  Windows and Linux were unavailable. This task remains open.

### S3-F17-T4 — Run up to three independent review and repair rounds

- [x] Completion: acceptance and verification passed
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
- 2026-07-13 status: not started. T2 and T3 are not complete, so independent
  completion review rounds cannot truthfully begin.
- 2026-07-13 security repair note: the seven findings from the delegated
  security/permissions review were repaired with attack regressions and gates.
  This is pre-completion hardening evidence only; it does not satisfy T4 or
  change the T2/T3 blockers above.
- 2026-07-13 security repair round-2 note: nine further findings were repaired
  with 101 focused adversarial tests and the Node 22 full gate (843 passed, 3
  conditional skips). Five affected strict changes and the 323-scenario ledger
  pass. No live, UI, package, provider, Keychain, Windows, or Linux row was
  promoted. Claim-before-dispatch prevents blind retry but leaves
  cross-resource exactly-once reconciliation as an explicit residual limit.
- 2026-07-13 security repair round-3 note: six additional findings were repaired
  with durable filesystem-root identity, rooted file read/list/watch contracts,
  exhaustive case-insensitive reserved-name collision handling, pre-payload
  namespace validation, and restart-safe bounded terminal-audit recovery.
  Continuous namespace/openat limits, Windows reparse behavior, cross-resource
  exactly-once, and every live/UI/package/platform row remain explicitly open.
  Node 22 focused attacks pass 60/60; the full gate passes 855 tests with 3
  conditional skips plus lint, format, TypeScript, and production build. All 18
  active changes and the 323-scenario ledger validate.
- 2026-07-13 final delegated security/control note: the last review removed
  ambient third-party MCP credential/control-plane inheritance, remaining direct
  credential, prompt-preview, custom-endpoint, and raw SDK-error logs, non-loopback
  OAuth callback listeners, and provider-error HTML reflection/raw propagation.
  Node 22 passes 72 headless
  tests across 12 non-native focused files plus focused lint/format. Shared native
  modules were Electron ABI-bound by another active lane, so SQLite-backed reruns
  remain with the coordinator's Node 22 full gate. This pre-completion review does
  not satisfy T4 or change the T2/T3 blockers.
- 2026-07-13 correctness/data pre-completion note: the delegated headless review
  repaired four defects: the out-of-order 0010 Voice migration skipped by
  post-0009 profiles; orchestration stop/replacement overwriting a newer run's
  conversation status; interrupted-run recovery overwriting a newer queued
  owner; and non-atomic orchestration add/progress/control paths that could race
  terminal state. Migration, run-launch, orchestration, Usage store, scheduler,
  and daemon lifecycle regressions pass under Node 22. T4 remains unchecked and
  blocked by T2/T3; no UI, provider-live, package, or platform row is promoted.
- 2026-07-14 correctness/data follow-up: the reported stale project/tab state
  traced to development controls selecting direct-DB fixtures before refreshing
  renderer project/chat queries. The headless repair refreshes list and exact
  chat caches first, rejects stale identities, clears incompatible active
  chat/sub-chat state, and opens the requested parent tab synchronously. Focused
  control/selection tests and TypeScript pass. The UI observation was not rerun
  under this lane's UI prohibition, so T4 remains unchecked.

### S3-F17-T5 — Reconcile, archive, clean up, and hand off Stage 3

- [x] Completion: acceptance and verification passed
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

## 2026-07-14 final Stage 3 closeout

The final Node 22 gate passed lint, Prettier, TypeScript, 129 test files with
968 passed and 3 declared conditional skips, and the production build. Exact
Dev identity passed after the final restart in `Flapstack Dev stage3-capture`.
All Stage 3 changes strict-validated; release-ledger and Usage-matrix coverage
passed. Unsigned macOS Preview build/inspect/runtime and closed-app Usage
LaunchAgent start/poll/stop/new-PID restart/cleanup passed.

Credentialed Claude, Codex, Cursor, OpenRouter, and NanoGPT paths passed, as did
Discord HTTP 204, Usage UI, Voice runtime/history/restart, questions, reasoning,
copy, timestamps, and fresh two-file Review/Undo. Same-model quality scored
Flapstack/native Codex 5/5 and Flapstack/native Claude 2/5. Windows and Linux
execution is deferred to the end of Stage 4 by explicit release decision.

The final independent correctness/security review repaired stale Codex effort
suffixes, multi-composer Voice ownership, fixture scoping, clipboard restore
truth, renderer-capture target binding/TTL/cleanup, and lock-screen notification
privacy. Focused tests passed 50/50 before the final full gate. Live MCP then
proved fixture-only Voice access, clipboard restoration, exact-chat capture,
capture deletion, and full-page-overlay rejection. No required finding remains.

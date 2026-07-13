# Stage 3 MCP Control Board

This is the sole authoritative task checklist for S3-F2 through S3-F6.

## S3-F2 — MCP Implementation

### S3-F2-T1 — Lock transport, identity, and registry architecture

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F2
- Outcome: One tested MCP architecture is approved for implementation.
- Scope: Compare stdio child and authenticated loopback transport; define caller
  attribution, lifecycle, one registry, tool catalog, risk tiers, and response contracts.
- Out of scope: Production implementation.
- Acceptance: Decisions cover startup, shutdown, discovery, authentication,
  multi-chat use, stale callers, and self-reference.
- Verification: Design review plus focused transport proof.
- Blocked by: S3-F1-T4, S3-F1-T5, approved proposal
- Blocks: S3-F2-T2, S3-F2-T3
- Relevant context: current MCP scaffold, Electron lifecycle, MCP SDK.

### S3-F2-T2 — Implement local MCP transport and lifecycle

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F2
- Outcome: A local client connects, lists tools, calls `ping` and `describe`, and disconnects cleanly.
- Scope: Implement approved transport, authentication, startup, shutdown, errors, and one registry bridge.
- Out of scope: App-object handlers.
- Acceptance: No non-local exposure; duplicate startup is safe; shutdown leaves no process or port.
- Verification: MCP SDK lifecycle smoke test.
- Blocked by: S3-F2-T1
- Blocks: S3-F2-T3, S3-F2-T4, S3-F3-T1
- Relevant context: Electron main lifecycle and `@modelcontextprotocol/sdk`.

### S3-F2-T3 — Implement compact read-only operations

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F2
- Outcome: Tier 0 tools inspect projects, tasks, chats, runs, worktrees, artifacts, and search results.
- Scope: Wrap existing services with validated inputs, scope checks, pagination, and stable response DTOs.
- Out of scope: Mutations or raw database output.
- Acceptance: Every catalogued Tier 0 operation is live, bounded, and secret-safe.
- Verification: Focused handler tests plus MCP SDK calls.
- Blocked by: S3-F2-T2
- Blocks: S3-F2-T5, S3-F4-T2
- Relevant context: existing tRPC query services and search contracts.

### S3-F2-T4 — Add harness registration and default-off per-chat exposure

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F2
- Outcome: Supported chats see Flapstack MCP only after the user enables it.
- Scope: Persist exposure, configure/unconfigure Codex and Claude, attach trusted identity, and reconcile startup state.
- Out of scope: Third-party MCP client redesign.
- Acceptance: Default off; disabling removes access; stale config fails closed.
- Verification: Config tests and credential-free harness discovery checks.
- Blocked by: S3-F2-T2
- Blocks: S3-F6-T1, S3-F5-T2
- Relevant context: existing Codex/Claude MCP config writers and chat settings.

### S3-F2-T5 — Implement structured additive and mutating operations

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F2
- Outcome: Approved tools create and manage supported app objects through shared services.
- Scope: Create chat/task, add attachment, rename, move, pin, archive, restore, worktree write, launch run, and automation draft handlers.
- Out of scope: Automation activation or bypassing the gate.
- Acceptance: Inputs are idempotent where required; stale targets fail safely; Tier 3 path and run protections hold.
- Verification: Per-tool service tests and rollback/error cases.
- Blocked by: S3-F2-T3, S3-F3-T3, S3-F3-T4, S3-F4-T2
- Blocks: S3-F5-T2, S3-F6-T4, S3-F6-T5
- Relevant context: existing mutations, attachments, worktrees, and run launch services.

### S3-F2-T6 — Rebase Stage 3 storage onto the current migration chain

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F2
- Outcome: Stage 3 storage upgrades cleanly from the rebased Stage 2 schema.
- Scope: Consolidate exposure, approval, audit, and custom-capability storage into
  the current post-Stage-2 migration; align snapshot and journal metadata.
- Out of scope: Rewrite historical application data.
- Acceptance:
  - A real Stage 2 migration state upgrades without a duplicate column or table.
  - Exposure defaults off; custom capabilities default null; approval/audit
    tables and append-only audit protection exist.
- Verification: `tests/stage3-migration-rebase.test.ts` and migration-chain tests.
- Verification evidence: fresh, current-main-era, and legacy Stage 3 fixtures
  pass the dedicated migration regression and the full Node 22 gate.
- Blocked by: S3-F4-T1
- Blocks: S3-F2-T7, S3-F6-T4
- Relevant context: `drizzle/0017_third_molecule_man.sql`, journal, snapshot,
  database initialization order.

### S3-F2-T7 — Recover only interrupted MCP-origin runs after startup

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F2
- Outcome: Startup never queries pre-migration tables or relaunches ordinary
  interrupted runs as MCP work.
- Scope: Initialize and migrate first; classify MCP-origin rows by MCP-owned
  prompt-message identity; move those rows to `pending`; cancel other `running`
  rows; drain only MCP pending rows; make repeated recovery idempotent.
- Out of scope: Resume arbitrary provider runs after a crash.
- Acceptance:
  - Fresh and upgraded profiles start without a recovery-before-migration error.
  - MCP-origin interrupted runs launch once after recovery.
  - Non-MCP interrupted runs become cancelled and never enter the MCP drain.
- Verification: `tests/mcp-main-run-launcher.test.ts` and
  `tests/stage3-migration-rebase.test.ts`.
- Blocked by: S3-F2-T6, S3-F5-T2
- Blocks: S3-F5-T3, S3-F6-T4
- Relevant context: database initialization, `recoverInterruptedMcpRuns`,
  `drainPendingMcpRuns`, `agent_runs.prompt_message_id`.

## S3-F3 — Permissions and Approvals

### S3-F3-T1 — Implement trusted caller identity and risk gate

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F3
- Outcome: Every call receives a trusted caller and deterministic gate decision.
- Scope: Resolve chat/run identity, permission mode, tier, target, and unsupported/stale caller states.
- Out of scope: Approval UI.
- Acceptance: Untrusted identity arguments cannot elevate access; every catalog tool has a tier.
- Verification: Complete caller-by-tier gate matrix.
- Blocked by: S3-F2-T2
- Blocks: S3-F3-T2, S3-F3-T3, S3-F4-T1
- Relevant context: run permissions, MCP registry, identity token design.

### S3-F3-T2 — Enforce the self-reference safety matrix

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F3
- Outcome: Agents cannot invalidate or recursively relaunch their own execution context.
- Scope: Define and test own chat/run/task/project rules for rename, move, archive, write, launch, and spawn.
- Scope boundary: S3-F5-T4 reuses this matrix and adds scheduler-specific
  concurrency, depth, ancestor, identity, permission, and audit enforcement.
- Acceptance: Every operation/target combination is explicit; blocked calls explain and audit the reason.
- Verification: Exhaustive self-reference unit matrix.
- Blocked by: S3-F3-T1
- Blocks: S3-F3-T3, S3-F5-T1
- Relevant context: caller lineage, target extraction, lifecycle rules.

### S3-F3-T3 — Implement approval lifecycle and session grants

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F3
- Outcome: Required operations wait for one durable user decision and finish exactly once.
- Scope: Pending state, approve, deny, timeout, cancellation, app shutdown, and in-memory session grants.
- Out of scope: Permanent blanket grants.
- Acceptance: Tier 3 always prompts; duplicate/late decisions cannot execute twice; grants expire with session/chat.
- Verification: Approval lifecycle concurrency tests.
- Blocked by: S3-F3-T1, S3-F3-T2
- Blocks: S3-F2-T5, S3-F3-T4, S3-F6-T2
- Relevant context: main-process lifecycle and renderer transport.

### S3-F3-T4 — Integrate approvals with tool execution

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F3
- Outcome: No mutation runs before its final gate and approval decision.
- Scope: Gate all handlers, revalidate target/context after approval, and return structured denial or timeout results.
- Out of scope: Handler business logic.
- Acceptance: Time-of-check changes fail closed; no alternate invocation path bypasses the gate.
- Verification: Allowed, denied, timeout, stale-target, and bypass regression tests.
- Blocked by: S3-F3-T3
- Blocks: S3-F2-T5, S3-F4-T2, S3-F6-T5
- Relevant context: registry invoker and handler dispatch.

### S3-F3-T5 — Enforce provider and product MCP gates once

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F3
- Outcome: Product MCP tools receive the intended combined authority without a
  bypass or duplicate approval prompt.
- Scope: Allow only registry Tier 0 product reads in read-only mode; keep
  third-party MCP denied; correlate ask-mode provider and app-control decisions;
  preserve mandatory fresh Stage 3 approval for Tier 3.
- Out of scope: Redefine provider-native permissions for non-MCP tools.
- Acceptance:
  - Read-only allows product Tier 0 and denies third-party MCP and product writes.
  - Ask mode shows one user decision for one product invocation.
  - Provider allow cannot bypass Tier 3 approval; denial remains fail-closed.
- Verification: `tests/mcp-provider-permission-integration.test.ts`.
- Blocked by: S3-F3-T3, S3-F3-T4
- Blocks: GPP-T9, S3-F5-T3, S3-F6-T4, S3-F12-T3
- Relevant context: provider permission builders, MCP registry tiers, approval
  coordinator and invocation IDs.

## S3-F4 — Audit History

### S3-F4-T1 — Add redacted MCP audit storage

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F4
- Outcome: MCP attempts and decisions persist in a queryable SQLite audit table.
- Scope: Schema, generated migration/snapshot, statuses, caller/tool/tier, timestamps, and redacted summaries.
- Out of scope: Raw secrets, hidden reasoning, or full payload archives.
- Acceptance: Upgrade works from Stage 2 DB; migration artifacts agree; redaction fixtures pass.
- Verification: Temporary-SQLite migration and insert/list tests.
- Blocked by: S3-F3-T1
- Blocks: S3-F2-T6, S3-F4-T2, S3-F4-T3
- Relevant context: Drizzle schema/journal and secret-redaction utilities.

### S3-F4-T2 — Audit every invocation and decision

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F4
- Outcome: Allowed, denied, approval-required, failed, and completed calls have correlated records.
- Scope: Instrument one invoker path, approval decisions, grants, errors, results, and durations.
- Out of scope: Renderer UI.
- Acceptance: No registered execution path lacks audit coverage; failed writes remain distinguishable from success.
- Verification: DB-backed end-to-end invoker tests.
- Blocked by: S3-F2-T3, S3-F3-T4, S3-F4-T1
- Blocks: S3-F2-T5, S3-F4-T3, S3-F5-T2, S3-F6-T5
- Relevant context: invoker, gate, approval service, audit table.

### S3-F4-T3 — Expose filtered audit queries

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F4
- Outcome: UI can page and filter audit records by caller, tool, decision, and time.
- Scope: Stable query contract, bounds, ordering, filters, and redacted detail DTO.
- Out of scope: Viewer rendering.
- Acceptance: Pagination has no hidden first-page ceiling; unauthorized raw fields are absent.
- Verification: Query/filter/pagination tests.
- Blocked by: S3-F4-T1, S3-F4-T2
- Blocks: S3-F6-T3
- Relevant context: app-control router and audit storage.

## S3-F5 — Cross-Agent Spawning and Task Orchestration

### S3-F5-T1 — Define safe thread-spawn contract

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F5
- Outcome: One provider-neutral contract defines target harness, scope, lineage, permission, worktree, and optional launch.
- Scope: Inputs, outputs, validation, approval summary, lineage fields, and loop rules.
- Out of scope: Durable task scheduling and aggregate UI, owned by S3-F5-T4.
- Acceptance: Contract supports Codex and Claude both directions without provider logic in renderer.
- Verification: Schema and forbidden-loop fixtures.
- Blocked by: S3-F3-T2
- Blocks: S3-F5-T2
- Relevant context: chat creation, run launch, harness adapters, lineage data.

### S3-F5-T2 — Implement approved cross-harness creation and launch

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F5
- Outcome: Approved Codex and Claude callers create and optionally launch target-harness threads.
- Scope: Durable chat creation, lineage, permission/worktree resolution, first run, rollback, and audit.
- Out of scope: Automatic spawning without approval.
- Acceptance: Claude-to-Codex and Codex-to-Claude work; failed launch leaves honest durable state; loops are blocked.
- Verification: Service integration tests with both directions.
- Blocked by: S3-F2-T4, S3-F2-T5, S3-F4-T2, S3-F5-T1
- Blocks: S3-F2-T7, S3-F5-T3, S3-F5-T4, S3-F6-T4
- Relevant context: shared chat/run services and supported harness adapters.

### S3-F5-T4 — Implement agent task orchestration

- [x] Completion: acceptance and verification passed
- Readiness: pickup-ready; every listed prerequisite is complete on this baseline.
- Parent: Project Flapstack / Stage S3 / Feature S3-F5
- Outcome: One named task durably coordinates a bounded, heterogeneous set of
  parent and worker chats with enforceable limits, honest usage, visible lineage,
  aggregate status, and safe lifecycle controls.
- Scope:
  - Backward-safe migrations for orchestration, worker/attempt, task membership,
    queue, budget/usage, stop state, and immutable parent/ancestor lineage.
  - Shared UI/product-MCP DTOs and services to create a named task or attach an
    orchestration to an eligible existing task.
  - Accessible fork markers and two-way parent/child navigation for every
    agent-spawned chat.
  - Per-worker role/name, prompt/spec, harness/provider, model, reasoning effort,
    permissions, worktree/branch strategy, dependencies, and completion criteria.
  - Durable dependency-aware scheduler with configurable per-task parallelism,
    transactional launch claims, restart recovery, and heterogeneous workers.
  - Completion/progress, wall-clock, token/cost, failure/blocker, and manual
    stop conditions with exact-versus-estimated cost provenance.
  - Aggregate task UI for progress, worker states, usage/cost, dependencies,
    lineage, results, stop reason, and pause/resume/stop/retry/replace/add controls.
  - Product-MCP and renderer invalidation parity; permission, approval, audit,
    loop, depth, duplicate-ancestor, stale-identity, and worktree protections.
- Out of scope: Hosted/cloud scheduling, unbounded hidden delegation, or
  presenting estimated provider cost as exact.
- Acceptance:
  - A request such as `Finish Stage 4` creates or reuses exactly one task and
    contains the initiating chat plus all descendants with navigable fork lineage.
  - Parallelism, dependencies, every stop condition, and pause/resume survive
    restart and concurrent drains without duplicate launches or completed-work replay.
  - Mixed Codex/Claude worker definitions retain their own immutable execution
    settings while sharing task state, budgets, queue, results, and controls.
  - Retry, replace, and add preserve prior attempts and lineage; unsafe or stale
    mutations fail closed and required mutations remain approved and audited.
  - Exact provider cost is used only when authoritative; otherwise the UI labels
    estimates and the scheduler enforces honest token/time ceilings.
- Verification: focused migration, DTO/service, scheduler concurrency/restart,
  budget/stop attack, MCP integration, renderer component/accessibility, lineage,
  permission/audit, and invalidation tests; Node 22 full check; strict OpenSpec;
  verified dev restart and safe live UI proof where available.
- Blocked by: S3-F3-T2, S3-F3-T4, S3-F3-T5, S3-F4-T2, S3-F5-T1, S3-F5-T2
- Blocks: S3-F5-T3, S3-F6-T4
- Relevant context: task/chat/run schema and services, spawn service, approval and
  audit gates, harness adapters, provider usage/cost contracts, Electron
  invalidation bridge, agent/task renderer surfaces.

### S3-F5-T3 — Prove cross-agent behavior live

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F5
- Outcome: Real Codex and Claude sessions prove both spawn directions and safety failures.
- Scope: Approval, denial, launch, fork navigation, task membership, bounded
  queue/stop behavior, restart, controls, self-loop denial, usage provenance,
  renderer invalidation, and audit evidence.
- Out of scope: Simulated provider sessions as a substitute for live evidence.
- Acceptance: Both directions pass in the verified `Flapstack Dev` profile with
  real Codex and Claude sessions; task membership, lineage, scheduler/run state,
  usage provenance, approval, audit, and renderer state agree.
- Verification: Documented manual matrix evidence.
- Blocked by: S3-F2-T7, S3-F3-T5, S3-F5-T2, S3-F5-T4, S3-F6-T2, S3-F6-T3
- Blocks: S3-F6-T4
- Relevant context: isolated Stage 3 worktree/app instance and manual matrix.

## S3-F6 — MCP Management and Safety UI

### S3-F6-T1 — Add MCP exposure and connection controls

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F6
- Outcome: User can see and change per-chat exposure and connection state.
- Scope: Default-off toggle, supported/unsupported state, registration errors, and current caller identity.
- Out of scope: Third-party MCP server management redesign.
- Acceptance: State is honest after restart and failures; enabling never silently focuses another window.
- Verification: Renderer state tests and manual reconnect check.
- Remaining verification: implementation and renderer tests pass; live
  enable/restart/disable/reconnect rows M-01 through M-04 and M-20 remain.
- Blocked by: S3-F2-T4
- Blocks: S3-F6-T4
- Relevant context: chat settings and existing agents settings surfaces.

### S3-F6-T2 — Add accessible approval UI without focus theft

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F6
- Outcome: User sees caller, tool, risk, target, and bounded input before deciding.
- Scope: Active-chat dialog, background notification/badge, approve, deny, timeout, and session grant option.
- Out of scope: OS activation for background requests.
- Acceptance: Background calls do not steal focus; keyboard/screen-reader flow works; stale decisions close safely.
- Verification: Component logic tests and manual active/background checks.
- Remaining verification: implementation and component tests pass; live active,
  background, deny, timeout, and session-grant rows M-05 through M-10 remain.
- Blocked by: S3-F3-T3
- Blocks: S3-F5-T3, S3-F6-T4
- Relevant context: shared dialog primitives and pending approval service.

### S3-F6-T3 — Add audit viewer

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F6
- Outcome: User can inspect and filter redacted MCP history.
- Scope: List, filters, pagination, compact detail, empty/error states, and links to safe targets.
- Out of scope: Editing or deleting audit records.
- Acceptance: Filters and paging match queries; no credential or hidden reasoning renders.
- Verification: Renderer tests and manual allowed/denied/failed review.
- Remaining verification: implementation and query/component tests pass; live
  paging, decision, and redaction rows M-18 and M-19 remain.
- Blocked by: S3-F4-T3
- Blocks: S3-F5-T3, S3-F6-T4, S3-F6-T5
- Relevant context: audit query DTO and settings/details UI.

### S3-F6-T5 — Refresh renderer state after MCP child mutations

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F6
- Outcome: Chat, run, approval, and audit changes made outside renderer tRPC
  appear in the open app without manual reload.
- Scope: Publish typed main-process invalidation events after committed MCP child
  mutations; bridge through preload; invalidate exact tRPC queries; coalesce
  bursts; ignore pre-commit and failed mutations.
- Out of scope: Poll every query or expose the development test-control token.
- Acceptance:
  - Created/archived chats and launched/stopped runs update visible lists/state.
  - Approval and audit panels refresh after external decisions and records.
  - Failed/rolled-back mutations do not show phantom success.
- Verification: `tests/mcp-external-mutation-refresh.test.ts` plus verified live
  mutation, approval, run, and audit observations.
- Remaining verification: the named transport, coalescing, exact-invalidation,
  and development-boundary regressions pass; live mutation, approval, run, and
  audit observations remain open.
- Blocked by: S3-F2-T5, S3-F3-T4, S3-F4-T2, S3-F6-T3
- Blocks: S3-F6-T4
- Relevant context: Electron main/preload event bridge, tRPC query invalidation,
  mutation service commit boundaries.

### S3-F6-T4 — Run integrated Stage 3 verification and closeout

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F6
- Outcome: Automated and manual evidence proves the complete safe-control workflow.
- Scope: Full check, strict OpenSpec, MCP SDK smoke, DB tests, tool matrix, Codex/Claude manual matrix, docs, and limitation reconciliation.
- Out of scope: Hosted orchestration or Stage 2 exit evidence.
- Acceptance: Every Stage 3 requirement and task passes; no required manual row is blocked; docs match shipped behavior.
- Verification: `npm run check`; strict OpenSpec validation; documented Stage 3 manual matrix.
- Blocked by: S3-F2-T5, S3-F2-T7, S3-F3-T5, S3-F5-T3, S3-F6-T1,
  S3-F6-T2, S3-F6-T3, S3-F6-T5
- Blocks: Stage 3 exit
- Relevant context: all Stage 3 changes, tests, and manual evidence.

## 2026-07-13 security and permissions repair evidence

- S3-F2-T4: disabling product MCP now commits exposure-off and cancellation of
  running launcher identities together, revokes active Claude/Codex sessions,
  and revalidates durable exposure on every call. Re-enabling accepts a new run
  identity but cannot revive the cancelled child. Development test-control and
  third-party MCP identities remain separate.
- S3-F3-T3/T4: every request receives a random internal UUID. Durable approval
  rows bind invocation, chat/run caller, tool, tier, and canonical-input hash;
  an ID collision or context mismatch cancels instead of inheriting approval.
- S3-F4-T1/T2: audit storage uses operation allowlists and content hashes rather
  than arbitrary payload text. Tier 1-3 dispatch requires a durable final
  pre-execution record; storage failure performs zero mutation. If the terminal
  append fails after dispatch, the durable allowed trail remains explicitly
  reconciliation-required.
- S3-F2-T5: MCP and renderer attachment writes share one fail-closed rooted
  writer with no-follow exclusive creation where supported, same-parent atomic
  replacement, and root/parent/final inode plus realpath checks around commit.
  Node does not expose portable `openat`/`renameat` directory-handle semantics,
  so no stronger continuous-race or Windows reparse-point guarantee is claimed.
- Attack regressions cover approval replay, immediate exposure disable and
  re-enable/new identity, audit disk/table/lock failure with zero mutation,
  completion reconciliation, and adversarial parent/final filesystem swaps.
  The Node 22 full gate and strict change validation pass on the repair tree.

## 2026-07-13 security and permissions repair round-2 evidence

- S3-F2-T4/S3-F3-T5: product classification now requires launcher-owned
  registration identity. A user third-party server named `flapstack` remains
  third-party and receives an explicit collision alias when product MCP is
  installed for the same run.
- S3-F2-T4: disabling exposure cancels and revokes only live runs registered as
  product-MCP-enabled children. Ordinary provider runs and their durable/live
  sub-chat state remain running.
- S3-F4-T1/T2: Tier 0 through Tier 3 all require a durable pre-dispatch
  `dispatch-started` claim. Terminal append failure returns its invocation ID,
  and an exact unresolved retry is blocked pending reconciliation. Arbitrary
  audit strings and unknown keys hash by default; a broad provider, cloud,
  URL/path, environment, PEM, JWT, and database secret corpus is covered.
- S3-F2-T5: files-router pasted-text, rename, and trash operations require a
  durable sub-chat or registered worktree plus relative rooted targets.
  Renderer secure-fs writes use the shared rooted writer. Traversal,
  absolute-path, symlink, root/parent/final swap, and identity attacks fail.
- Node 22 focused attacks passed 101/101 across 17 files. The full gate passed 113
  files with 843 tests passed and 3 conditional skips, plus lint, formatting,
  TypeScript, and build. The affected strict changes and 323-scenario ledger
  pass. S3-F6-T4 remains unchecked because live UI/platform acceptance is open.
- Claim-before-dispatch blocks blind retry but cannot provide cross-resource
  exactly-once behavior if the process dies between claim and handler.

## 2026-07-13 security and permissions repair round-3 evidence

- S3-F2-T4/S3-F2-T5: every case-insensitive Claude reserved-name collision is
  renamed, and product permission classification accepts only the exact
  launcher-owned registration name. Files read/list/watch plus adjacent
  attachment, command, skill, agent, and directory contracts no longer accept
  arbitrary renderer absolute paths.
- Registered project/worktree paths are migration-backfilled to immutable
  canonical realpath and filesystem identity records. New projects/worktrees
  bind before use; missing, symlinked, moved, or replaced roots fail closed
  before read/write/rename/trash dispatch. Legacy rows have no historical
  identity to reconstruct, so migration can bind only the current real,
  non-symlink directory; missing or symlinked legacy roots remain unbound.
- Rooted replacement validates the namespace before creating a secret-bearing
  temporary file. Deterministic moved/original/replacement-parent attacks prove
  no payload or temporary survives; portable continuous namespace races and
  Windows reparse semantics remain explicit limitations.
- Terminal-audit claims now have durable recovery states, startup/runtime
  reconciliation, one explicit bounded retry for retry-safe fingerprints, and
  operator reconciliation for unknown outcomes. Exact non-idempotent unknown
  outcomes remain blocked; different invocation input is not globally poisoned.
- This repair does not claim cross-resource exactly-once behavior, portable
  directory-handle transactions, or any live UI/package/platform result.
- Node 22 focused attacks pass 60/60 across 11 files. The full gate passes lint,
  format, TypeScript, 855 tests with 3 conditional skips, and production build.
  All 18 active changes strict-validate; the ledger covers 323 scenarios and 17
  feature exits.

## 2026-07-13 MCP-first management closeout evidence

- S3-F6-T1: exposure now distinguishes disabled, next-run, connected, and
  unsupported states from live launcher sessions. Claude durable harness
  `claude-code` normalizes to the supported Claude product identity. Disable
  cancels mapped runs and resolves pending approvals as deny.
- S3-F6-T2: background approvals expose an accessible Review action without
  opening/focusing the caller chat. Clicking Review is the only path that
  selects the caller. Tier 3 exposes no reusable session-grant option.
- S3-F6-T3: the audit viewer includes filtered/paged history and explicit
  terminal-dispatch recovery controls for bounded retry or externally verified
  reconciliation. Successful approved calls now record
  `approval-required`, `allowed`, `dispatch-started`, and terminal state.
- S3-F6-T5: the live app observed external approval, audit, run, and exposure
  changes created through authenticated test-control MCP without reload.
- Authenticated dev controls now prepare only isolated named caller fixtures,
  bind an optional worktree only when it exactly matches the running checkout,
  drive real product stdio calls, expose bounded truth, restrict approvals and
  recovery to those fixtures, and clean pending/terminal children safely.
- Live Claude-to-Codex target launch passed. The reverse real Claude target run
  failed because the dev checkout lacked its bundled Claude binary/provider
  stream. Full provider-session, active-dialog, keyboard/screen-reader,
  session-grant, viewer-pixel, and platform rows remain open. Therefore
  S3-F5-T3 and S3-F6-T1/T2/T3/T5/T4 remain unchecked.
- Final focused MCP/management verification passes 54 tests across 11 files.
  Node 22 `npm run check` passes lint, formatting, TypeScript, 117 test files
  with 863 passed and 3 conditional skips, and the production build. The three
  affected strict changes and release-ledger coverage pass.

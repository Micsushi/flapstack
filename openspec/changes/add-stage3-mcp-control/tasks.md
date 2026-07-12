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
- Blocks: S3-F5-T2, S3-F6-T4
- Relevant context: existing mutations, attachments, worktrees, and run launch services.

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
- Out of scope: General orchestration limits.
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
- Blocks: S3-F2-T5, S3-F4-T2
- Relevant context: registry invoker and handler dispatch.

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
- Blocks: S3-F4-T2, S3-F4-T3
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
- Blocks: S3-F2-T5, S3-F4-T3, S3-F5-T2
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

## S3-F5 — Cross-Agent Spawning

### S3-F5-T1 — Define safe thread-spawn contract

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F5
- Outcome: One provider-neutral contract defines target harness, scope, lineage, permission, worktree, and optional launch.
- Scope: Inputs, outputs, validation, approval summary, lineage fields, and loop rules.
- Out of scope: Rich graph, budgets, depth limits, or swarm policy.
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
- Blocks: S3-F5-T3, S3-F6-T4
- Relevant context: shared chat/run services and supported harness adapters.

### S3-F5-T3 — Prove cross-agent behavior live

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F5
- Outcome: Real Codex and Claude sessions prove both spawn directions and safety failures.
- Scope: Approval, denial, launch, lineage inspection, self-loop denial, stop, and audit evidence.
- Out of scope: Stage 2 test app or automated UI focus control.
- Acceptance: Both directions pass in isolated Stage 3 app data; no test steals focus from Stage 2 testing.
- Verification: Documented manual matrix evidence.
- Blocked by: S3-F5-T2, S3-F6-T2, S3-F6-T3
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
- Blocked by: S3-F4-T3
- Blocks: S3-F5-T3, S3-F6-T4
- Relevant context: audit query DTO and settings/details UI.

### S3-F6-T4 — Run integrated Stage 3 verification and closeout

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S3 / Feature S3-F6
- Outcome: Automated and manual evidence proves the complete safe-control workflow.
- Scope: Full check, strict OpenSpec, MCP SDK smoke, DB tests, tool matrix, Codex/Claude manual matrix, docs, and limitation reconciliation.
- Out of scope: Stage 4 orchestration or Stage 2 exit evidence.
- Acceptance: Every Stage 3 requirement and task passes; no required manual row is blocked; docs match shipped behavior.
- Verification: `npm run check`; strict OpenSpec validation; documented Stage 3 manual matrix.
- Blocked by: S3-F2-T5, S3-F5-T3, S3-F6-T1, S3-F6-T2, S3-F6-T3
- Blocks: Stage 3 exit
- Relevant context: all Stage 3 changes, tests, and manual evidence.

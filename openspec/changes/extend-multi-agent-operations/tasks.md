# S4-F3 — Multi-Agent Operations

### S4-F3-T1 — Reconcile the Stage 3 orchestration baseline

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F3
- Outcome: Stage 4 has an exact delta from the shipped Stage 3 scheduler, task controls, and the S4-F11 Agent Runtime boundary.
- Scope: Archive/review the Stage 3 contract; inspect remaining live evidence; map current DTO/service/UI behavior; trace chat/run materialization; consume the S4-F11 runtime/activity contract; and list only additive orchestration gaps.
- Out of scope: Reimplementing scheduler, budgets, depth, retry, replace, add, pause, resume, stop, or saved workspaces.
- Acceptance: Every Stage 4 requirement maps to an existing primitive or named additive change; the review explicitly records that Stage 3 has durable agent chats/runs but not saved multi-agent workspaces, coordination engines, mailboxes, workflow scripts, or runtime-aware group activity; provider event fidelity is delegated to S4-F11; unresolved Stage 3 evidence is a blocker.
- Verification: Contract-to-source/test trace, database fixture inspection, cloned-reference SHA/license record, and strict validation after Stage 3 archive.
- Blocked by: Stage 3 S3-F5/S3-F6/S3-F17 exit and archive
- Blocks: S4-F3-T2, S4-F3-T3, S4-F3-T5, S4-F3-T6
- Context: `add-stage3-mcp-control`, orchestration service, S4-F11 runtime/activity contract, task card, Stage 3 matrix, and the comparative research in `design.md`.
- Evidence: `docs/stage4-s4-f3-t1-orchestration-baseline.md`.

### S4-F3-T2 — Add the orchestration fleet query and view

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F3
- Outcome: Users supervise orchestrations across tasks and projects from one local view.
- Scope: Paginated/filterable aggregate query, active/terminal filters, engine/provider/usage provenance, workflow phase or task-tree identity, blockers, operation-workspace navigation, polling/invalidation, and empty/stale states.
- Out of scope: Editing policy, executing workflow scripts, or graph rendering.
- Acceptance: View is a projection of authoritative rows; completed work is never relaunched by reading; engine and archived scope are explicit.
- Verification: Query pagination/scope/restart tests and component/accessibility tests.
- Blocked by: S4-F3-T1, S4-F3-T6
- Blocks: S4-F3-T3, S4-F3-T10
- Context: spawned-agents router, task card, project/task navigation, saved-workspace link.
- Code-ready evidence: The read-only fleet base applies project/task/status/lifecycle/archive/provider/count/facet/sort/keyset scope in SQL before reading only the current page's agents, with stable fail-closed cursors and 500-ID agent batches. The 1,005-row fixture reads 25 agent rows for a 25-row page and preserves explicit legacy-engine/provider/cost/freshness truth, scoped Tier-0 MCP reads, five-second polling, all-window invalidation, and accessible roving focus. Fleet rows now expose the authoritative orchestration-owned saved workspace and navigate through the existing saved-workspace selection contract without creating ownership. Component coverage verifies the exact workspace ID. Completion remains open for assigned live UI/accessibility, multi-window, package, and provider evidence.

### S4-F3-T3 — Add rich lineage, messaging, and navigation

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F3
- Outcome: Spawn/replacement history, workflow phases, Codex task paths, and supported agent messages are understandable and navigable.
- Scope: Graph/tree projection, workflow/task-tree overlays, status/role/harness/engine labels, replacement edges, stale/orphan state, mailbox/message provenance, send/follow-up/interrupt affordances when supported, keyboard navigation, and focus/open-in-workspace behavior.
- Out of scope: Editing graph edges or synthesizing unsupported provider messages.
- Acceptance: Every node/edge/message matches durable lineage; stale nodes remain visible; capability-gated controls state their semantics; navigation never creates duplicate ownership.
- Verification: Graph projection, cycle-defense, stale-node, mailbox ordering, capability, keyboard, accessibility, and multi-window tests.
- Blocked by: S4-F3-T1, S4-F3-T2, S4-F3-T6
- Blocks: S4-F3-T10
- Context: `getLineage`, chat ownership, operation workspace roster, engine adapter DTOs.
- Code-ready evidence: Durable tree/edge/message projection, cycle defense, missing-parent placeholders, stale/orphan/chat truth, capability reasons, ordered messages, roving keyboard focus, and chat navigation are integrated and focused-tested. Capability-gated V2 send/follow-up/interrupt controls dispatch through durable provider identity; V1 keeps follow-up disabled rather than synthesizing V2 behavior. Fleet operation-workspace navigation uses the saved-workspace owner row. Live UI, keyboard/screen-reader, real provider, and multi-window proof remain open.

### S4-F3-T4 — Add versioned policy and workflow templates

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F3
- Outcome: Users safely reuse and change bounded worker, workflow, and policy definitions.
- Scope: Policy version, impact preview, tighten/relax classification, approval/audit, template CRUD, workflow script/graph and schema storage, agent definition snapshots, secret/session stripping, resolved preview, and compatibility validation.
- Out of scope: An uncurated agent-personality marketplace or automatic template execution.
- Acceptance: Stale updates fail; authority/budget increases require approval; templates contain no live authority or secrets; presentation style cannot change capability; workflow scripts are inspectable and versioned.
- Verification: Version conflict, policy classification, approval/audit, template redaction, schema validation, profile-authority separation, and restart tests.
- Blocked by: S4-F3-T6 and Stage 3 gate/audit
- Blocks: S4-F3-T5, S4-F3-T7, S4-F3-T8, S4-F3-T10, S4-F6-T7, S4-F12-T5
- Context: orchestration schemas, approval coordinator, redacted audit, saved definitions.
- Code-ready evidence: Mobile-free 0035 adds append-only policy history and safe versioned templates. Authority/budget relaxations now obtain a fresh Tier-3 Stage 3 approval, verify its exact caller/tool/context/audit record, and consume the audit once; fake or replayed IDs fail. Recursive key and string-value scanning rejects credential, token, private-key, live-identity, URL-authority, and secret-path payloads across prompt/spec/completion/model/path fields. Live approval UX remains unclaimed.

### S4-F3-T5 — Harden cascading control and recovery

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F3
- Outcome: Pause/stop/cancel state remains truthful across workflow steps, provider descendants, failures, and restart.
- Scope: Durable action intent, engine-aware descendant traversal, signal reconciliation, partial failures, orphan policy, stale leases, restart recovery, exact impact preview, and uncertain-spawn handling without replay.
- Out of scope: OS process control outside Flapstack-owned runs.
- Acceptance: No descendant launches after stop intent; restart resumes cancellation only; uncertain provider actions are reconciled rather than replayed; failures and orphans remain visible.
- Verification: Concurrent cascade, crash/restart, stale lease, partial signal, uncertain spawn, orphan, and forbidden-scope tests for every engine.
- Blocked by: S4-F3-T1, S4-F3-T4, S4-F3-T7, S4-F3-T8
- Blocks: S4-F3-T10
- Context: scheduler tick, cancellation requests, engine adapters, run adapters, lineage rows.
- Code-ready evidence: Cascade request re-queries and materializes descendants under one immediate transaction, rejects stale fingerprints, and records durable stop intent before the concrete F11 provider-neutral cancel call. F3 pause/resume consumers call optional provider-neutral F11 authority first and mutate task/workflow truth only after every target acknowledges; absent authority and partial failures fail closed. This packet does not implement F11 singleton lifecycle or provider dispatch. Per-target claims, restart retry, orphan/stale-lease truth, partial failures, and bounded redacted provider errors are focused-tested. F11 pause/resume authority, real provider cancellation semantics, and live restart proof remain open with F11-T10.

### S4-F3-T6 — Define coordination engines, settings, and profile boundaries

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F3
- Outcome: `workflow`, `codex-v2`, and `codex-v1` have one typed lifecycle contract and predictable user selection.
- Scope: Engine/version enum, capability probe, action/result contract, provider identity mapping, global/project/per-launch precedence, immutable resolved snapshot, migration of legacy rows, Settings and launch previews, unsupported-state UX, and a written promotion gate for agent profiles/personalities.
- Out of scope: Implementing an engine, profile editor, profile marketplace, or importing OMO/ECC agents.
- Acceptance: `workflow` is the default; V2 is capability-gated; V1 is advanced/legacy; active runs cannot switch engines; no unavailable mode silently falls back; profile research separates capability, presentation, workflow, and runtime snapshot.
- Verification: Schema/migration, precedence, immutable snapshot, capability, unsupported-state, and settings accessibility tests plus design review of the profile gate.
- Blocked by: S4-F3-T1, S4-F11-T2
- Blocks: S4-F3-T2, S4-F3-T3, S4-F3-T4, S4-F3-T7, S4-F3-T8, S4-F3-T9, S4-F4-T6, S4-F11-T9, S4-F12-T1, S4-F12-T2
- Context: agent-orchestration schemas/service, S4-F11 runtime compatibility/snapshot contract, settings search, Codex coordination capability metadata, `design.md` comparison.
- Evidence: Typed/versioned workflow, Codex V2, and Codex V1 contracts; global/project/per-launch resolution; fail-closed capability probes; immutable v1 launch snapshots; exact legacy-v0 migration; database-enforced canonical snapshots and history-only legacy rows; Settings/launch preview accessibility; and the profile promotion boundary are integrated. Node 22 passed the worker's 320-test migration/Runtime/activity/orchestration/engine/UI gate, the coordinator's 80 focused integrated tests, TypeScript, touched ESLint/Prettier, production build, strict OpenSpec, and diff check. Live/package/provider/device evidence remains unclaimed.

### S4-F3-T7 — Implement the deterministic workflow engine

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F3
- Outcome: The default engine runs inspectable, restart-safe multi-agent workflows without putting orchestration state in the lead model context.
- Scope: Restricted versioned runtime, agent/parallel/pipeline primitives, typed variables and output schemas, branches/loops/barriers, concurrency and total-agent caps, phase checkpoints, retries/timeouts, pause/resume/stop, human-gate segmentation, preview, scale warnings, and final synthesis.
- Out of scope: Direct workflow filesystem/shell/network access, arbitrary package imports, or hidden mid-script approvals.
- Acceptance: Script control flow is deterministic and inspectable; workers alone mutate project state; completed checkpoints are reused on resume; required failed dimensions fail closed; budgets and stop intent prevent new launches.
- Verification: Runtime sandbox, schema, parallel/barrier, loop termination, crash/restart, cached resume, fail-closed, scale cap, permission, and mixed Codex/Claude worker tests.
- Blocked by: S4-F3-T4, S4-F3-T6, S4-F11-T9
- Blocks: S4-F3-T5, S4-F3-T9, S4-F3-T10, S4-F4-T6, S4-F12-T5
- Context: Stage 3 scheduler/service, Anthropic dynamic-workflow behavior reference, ECC `orch-review.workflow.js` research pattern.
- Code-ready evidence: Run plus initial checkpoints commit atomically. The restricted graph validates IDs/dependencies/cycles, stable unique agent-definition references, and truthful branch/loop/parallel/pipeline/barrier/human-gate definitions; enforces spawn, parallel/total-agent, token/cost, retry, timeout, output-schema, and stop limits; reuses completed checkpoints; and never replays uncertain launches. Missing worker identities are materialized transactionally from immutable agent definitions and Runtime snapshots. Generic pending-run drain excludes workflow-owned reservations, while a dedicated startup scheduler advances durable runs. Ready worker waves launch concurrently within policy caps; dependent phases advance after the wave. When optional F11 structured-output authority exists, F3 JSON-schema validates and stores its immutable activity reference without copying Runtime activity; absent authority follows persisted retry/failure policy. Pause/resume consumers likewise fail closed without optional F11 authority. F11 implementation/acceptance, assigned live UI, and live mixed-worker proof remain open.

### S4-F3-T8 — Implement Codex V2 and V1 engine adapters

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F3
- Outcome: Users can choose native Codex task-tree behavior or explicit legacy compatibility while Flapstack keeps durable ownership.
- Scope: V2 canonical paths, selective `fork_turns`, mailbox/send/follow-up, interrupt/list/wait, completion envelopes, residency/reload, and context metadata; V1 agent IDs/nicknames, send-input interrupt, final wait, resume/close; capability/version pinning; provider-ID reconciliation; and advanced labeling.
- Out of scope: Reimplementing Codex internals, pretending V1 supports V2 semantics, or making native Codex modes the default.
- Acceptance: Every provider action records intent before dispatch; V2 workers preserve task identity across follow-ups/unload; V1 remains ID-based and visibly legacy; unknown protocol events fail closed; restart never duplicates an uncertain spawn.
- Verification: Mock app-server protocol fixtures, real supported Codex walkthrough, context-fork boundaries, mailbox ordering, interrupt/follow-up, residency, V1 lifecycle, version drift, and restart tests.
- Blocked by: S4-F3-T4, S4-F3-T6, S4-F11-T9
- Blocks: S4-F3-T5, S4-F3-T9, S4-F3-T10, S4-F4-T6
- Context: Codex app-server transport, cloned Codex V1/V2 tool specs and residency behavior, run launch service.
- Code-ready evidence: V2/V1 adapters use canonical idempotency payloads, atomic unique-key insert ownership, intent/key propagation to provider dispatch/reconcile, renewable reconciliation claims, and no database connection across provider awaits. Each invocation reconciles its stable initial candidate set once and preserves running/waiting/uncertain truth for later retries. Exactly-one claimed intent update and durable message insertion commit together. Provider-returned identities are validated and projected from immutable intents without mutating the engine snapshot. Startup registration and fail-closed capability-probe seams preserve the F11 Runtime registration. V2 accepts only canonical POSIX absolute paths or fully qualified Windows drive-root/UNC paths; traversal, ambiguous root-relative, and non-normal forms fail closed. The current Codex app-server exposes worker turns/activity but no direct native multi-agent task-tool RPC, so an honest production V2/V1 coordination client cannot be registered from this checkout; real supported Codex and Windows-live proof remain open rather than using a prompt-mediated fake.

### S4-F3-T9 — Aggregate multi-agent runtime activity

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F3
- Outcome: Users understand workflow and coordination progress across every worker without duplicating or relabeling runtime-native activity.
- Scope: Workflow phase/checkpoint, dependency/barrier, spawn/replacement, mailbox/follow-up, coordination message, warning, usage, and aggregate status events; references to authoritative runtime events; agent/runtime/phase filters; workspace/fleet projections; activity summaries; batching/virtualization reuse; restart projection rebuild.
- Out of scope: Parsing provider streams, rendering provider-native reasoning, changing reasoning controls, or copying provider event text into orchestration rows.
- Acceptance: Every group event references its orchestration/agent/run and optional source runtime event; mixed-runtime ordering/provenance survives; generated prose is Activity summary; projections rebuild without replay or duplication.
- Verification: Mixed-runtime fixtures, workflow/mailbox ordering, reference integrity, projection rebuild, dedup, large-fleet performance, accessibility, restart, and live heterogeneous workflow tests.
- Blocked by: S4-F3-T6, S4-F3-T7, S4-F3-T8, S4-F11-T3, S4-F11-T7
- Blocks: S4-F3-T10
- Context: shared reasoning-output contract/normalizers, Claude transformer, Codex reasoning poller/app-server events, assistant message timeline.
- Code-ready evidence: Durable append-only transition sources are written automatically with orchestration, agent, workflow, cascade, and coordination state changes, then projected immediately and rebuilt after restart without inferring history from current snapshots. Runtime activity remains reference-only; the concrete F11 bridge derives its cursor from authoritative `agent_activity_events` sequence high-water and copies no provider text. Summary text is bounded and secret-redacted before both source and projection storage. The public UI repair mutation was removed. Live heterogeneous activity proof remains open.

### S4-F3-T10 — Close multi-agent operations acceptance

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F3
- Outcome: Engines, fleet, graph, policy, templates, workspaces, runtime activity, and cascading control pass with real supported harnesses.
- Scope: Full gate, matrix S4-MA01 through S4-MA10, workflow and both Codex modes, heterogeneous orchestration, operation workspace, runtime-activity aggregation, restart, docs, and package preview.
- Out of scope: Hosted swarm control, S4-F12 agent profiles/personalities, and a hosted profile marketplace.
- Acceptance: One workflow orchestration and supported Codex modes are supervised, messaged, stopped/resumed/recovered, and inspected with matching UI, database, workspace, run, activity, usage, approval, and audit state.
- Verification: `npm run check`, strict OpenSpec, `npm run dev:verify`, live orchestration verification, real supported Codex/Claude walkthroughs, and packaged preview evidence.
- Blocked by: S4-F3-T2, S4-F3-T3, S4-F3-T4, S4-F3-T5, S4-F3-T7, S4-F3-T8, S4-F3-T9, S4-F4-T6, S4-F11-T10
- Blocks: Stage S4 integrated exit
- Context: `docs/stage4-full-feature-test-matrix.md`.
- Review evidence: `docs/stage4-s4-f3-multi-agent-operations.md`. S4-MA01 through S4-MA10 remain open pending F11-T10, a supported direct Codex coordination transport, real harness walkthroughs, the separately assigned live UI/accessibility/multi-window queue, restart/cancellation inspection, and packaged preview evidence.

# S4-F3 — Multi-Agent Operations

### S4-F3-T1 — Reconcile the Stage 3 orchestration baseline

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F3
- Outcome: Stage 4 has an exact delta from the shipped Stage 3 scheduler and task controls.
- Scope: Archive/review Stage 3 contract, inspect remaining live evidence, map current DTO/service/UI behavior, and list only additive Stage 4 gaps.
- Out of scope: Reimplementing scheduler, budgets, depth, retry, replace, add, pause, resume, or stop.
- Acceptance: Every Stage 4 requirement maps to an existing primitive or a named additive change; unresolved Stage 3 evidence is a blocker.
- Verification: Contract-to-source/test trace and strict validation after Stage 3 archive.
- Blocked by: Stage 3 S3-F5/S3-F6/S3-F17 exit and archive
- Blocks: S4-F3-T2, S4-F3-T3, S4-F3-T4, S4-F3-T5
- Context: `add-stage3-mcp-control`, orchestration service, task card, Stage 3 matrix.

### S4-F3-T2 — Add the orchestration fleet query and view

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F3
- Outcome: Users supervise orchestrations across tasks and projects from one local view.
- Scope: Paginated/filterable aggregate query, active/terminal filters, provider/usage provenance, blockers, navigation, polling/invalidation, empty/stale states.
- Out of scope: Editing policy or graph rendering.
- Acceptance: View is a projection of authoritative rows; completed work is never relaunched by reading; archived scope is explicit.
- Verification: Query pagination/scope/restart tests and component/accessibility tests.
- Blocked by: S4-F3-T1
- Blocks: S4-F3-T3, S4-F3-T6
- Context: spawned-agents router, task card, project/task navigation.

### S4-F3-T3 — Add rich lineage and navigation

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F3
- Outcome: Spawn and replacement history is understandable and navigable at fleet and task scope.
- Scope: Graph/tree projection, layout, status/role/harness labels, replacement edges, stale/orphan state, keyboard navigation, focus/open-in-window behavior.
- Out of scope: Editing graph edges.
- Acceptance: Every node/edge matches durable lineage; stale nodes remain visible; navigation never creates duplicate ownership.
- Verification: Graph projection, cycle-defense, stale-node, keyboard, accessibility, and multi-window tests.
- Blocked by: S4-F3-T1, S4-F3-T2
- Blocks: S4-F3-T6
- Context: `getLineage`, chat ownership, existing fork navigation.

### S4-F3-T4 — Add versioned policy editing and templates

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F3
- Outcome: Users safely reuse and change bounded worker definitions and limits.
- Scope: Policy version, impact preview, tighten/relax classification, approval/audit, template CRUD, secret/session stripping, resolved preview.
- Out of scope: Automatic template execution.
- Acceptance: Stale updates fail; authority/budget increases require approval; templates contain no live authority or secrets.
- Verification: Version conflict, policy classification, approval/audit, template redaction, and restart tests.
- Blocked by: S4-F3-T1 and Stage 3 gate/audit
- Blocks: S4-F3-T5, S4-F3-T6, S4-F6-T7
- Context: orchestration schemas, approval coordinator, redacted audit.

### S4-F3-T5 — Harden cascading control and recovery

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F3
- Outcome: Pause/stop/cancel state remains truthful across descendants, failures, and restart.
- Scope: Durable cancellation intent, descendant traversal, signal reconciliation, partial failures, orphan policy, stale leases, restart recovery, exact impact preview.
- Out of scope: OS process control outside Flapstack-owned runs.
- Acceptance: No descendant launches after stop intent; restart resumes cancellation only; failures and orphans remain visible.
- Verification: Concurrent cascade, crash/restart, stale lease, partial signal, orphan, and forbidden-scope tests.
- Blocked by: S4-F3-T1, S4-F3-T4
- Blocks: S4-F3-T6, S4-F10-T6
- Context: scheduler tick, cancellation requests, run adapters, lineage rows.

### S4-F3-T6 — Close multi-agent operations acceptance

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F3
- Outcome: Fleet, graph, policy, templates, and cascading control pass with real supported harnesses.
- Scope: Full gate, matrix S4-MA01 through S4-MA05, real Codex/Claude walkthrough, restart, docs, and package preview.
- Out of scope: Hosted swarm control.
- Acceptance: One heterogeneous orchestration is supervised and stopped/recovered with matching UI, database, run, usage, approval, and audit state.
- Verification: `npm run check`, strict OpenSpec, `npm run dev:verify`, live orchestration verification, and packaged preview evidence.
- Blocked by: S4-F3-T2, S4-F3-T3, S4-F3-T4, S4-F3-T5
- Blocks: Stage S4 integrated exit
- Context: `docs/stage4-full-feature-test-matrix.md`.

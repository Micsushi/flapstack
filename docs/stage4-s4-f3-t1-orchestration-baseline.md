# S4-F3-T1 Stage 3 orchestration baseline

This is the frozen delta from the shipped Stage 3 orchestration contract to
S4-F3 Multi-Agent Operations. It records code and fixture evidence only; it
does not change scheduler, launch, provider, or renderer behavior.

## Baseline and authority

- Shipped baseline: annotated `stage3-final` commit `a674784`.
- Stage 3 contract: archived change
  `openspec/changes/archive/2026-07-14-add-stage3-mcp-control/`.
- Stage 3 release truth: `docs/stage3-full-feature-test-matrix.md` and
  `docs/stage3-release-handoff.md` report every required Stage 3 row complete
  and no remaining Stage 3 proof blocker. Windows/Linux execution is deferred
  to Stage 4 and public signing/Admin usage are future considerations, not
  Stage 3 blockers.
- Stage 4 authority: the newest read-only
  `extend-multi-agent-operations/{design.md,tasks.md}` in the integration
  checkout and the planned `add-agent-runtimes` contract.

## Shipped durable envelope

| Stage 3 primitive                                                                                                                                                                                                    | Source                                                                                                                                | Contract/fixture proof                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Task-owned orchestration and worker rows, immutable definitions, dependency/spawn/replacement lineage, queue state, limits, stop state, usage, and chat/run foreign keys                                             | `drizzle/0022_agent_task_orchestration.sql`; `src/main/lib/db/schema/index.ts`                                                        | `tests/stage3-migration-rebase.test.ts`; `tests/agent-orchestration-service.test.ts`       |
| Bounded DTOs for Codex/Claude workers, permissions, worktrees, dependencies, parallel/depth limits, stop conditions, progress, aggregate state, and lineage                                                          | `src/shared/agent-orchestration.ts`                                                                                                   | `tests/agent-orchestration-service.test.ts`; `tests/orchestration-task-card.test.tsx`      |
| One SQLite-authoritative scheduler for create/attach, dependency readiness, transactional materialization, restart reconciliation, budgets, retry/replace/add, pause/resume/stop, cancellation requests, and archive | `src/main/lib/agent-orchestration/service.ts`                                                                                         | `tests/agent-orchestration-service.test.ts`                                                |
| Product-MCP and renderer entry points reuse the same schemas/service; orchestration creation stays Tier 3 approved and audited                                                                                       | `src/main/lib/mcp-control/mutation-service.ts`; `src/main/lib/mcp-control/registry.ts`; `src/main/lib/trpc/routers/spawned-agents.ts` | `tests/agent-orchestration-service.test.ts`; `tests/mcp-external-mutation-refresh.test.ts` |
| Task details UI shows aggregate state, honest usage quality, stop limits, lineage navigation, and pause/resume/stop/retry/replace/add controls                                                                       | `src/renderer/features/agents/ui/orchestration-task-card.tsx`; `src/renderer/features/details-sidebar/details-sidebar.tsx`            | `tests/orchestration-task-card.test.tsx`; `tests/mcp-test-control.test.ts`                 |
| Main-process polling reconciles orchestration state, consumes durable cancellation requests, then drains only claimed pending MCP-origin runs through normal harness routers                                         | `src/main/index.ts`; `src/main/lib/run-launch-service.ts`; `src/main/lib/main-run-launcher.ts`                                        | `tests/mcp-main-run-launcher.test.ts`; `tests/agent-orchestration-service.test.ts`         |

### Chat/run materialization

For each eligible queued worker, `materializeAgent` resolves the registered
worktree and writes one task-scoped `chats` row, one compatibility `sub_chats`
row, one pending `agent_runs` row, then binds their IDs to the authoritative
`orchestration_agents` row. The chat records immutable parent, initiator,
ancestor, permission, harness/model, worktree, and branch identity. The run
records the prompt, permission snapshot, worktree, harness/model, and pending
status before the main-process launcher claims provider work.

`tests/agent-orchestration-service.test.ts` proves distinct durable chat/run
identity, dependency release after durable completion, bounded concurrent and
restart drains, no completed-worker replay, cancellation reconciliation,
retry/replacement lineage, stop conditions, registered-worktree enforcement,
and Tier 3 caller/approval/audit enforcement. The migration fixture explicitly
requires both orchestration tables and their lineage, dependency, budget, and
blocker columns.

## S4-F11 Agent Runtime boundary

Coordination engine and Agent Runtime are independent axes. S4-F3 owns how a
group cooperates. S4-F11 owns how each worker selects a compatible transport,
starts/resumes, persists provider activity, and renders it.

S4-F3 consumes these S4-F11 outputs without duplicating them:

- T2: harness-keyed Runtime compatibility/resolution plus immutable run
  snapshot fields for runtime, adapter/protocol version, capabilities, and
  controls before provider work.
- T3: append-only `agent_activity_events` with stable run sequence, provider
  identities/indices, privacy class, bounded payload, and deduplication.
- T7: the shared accessible Runtime activity timeline and formatter boundary.
- T9: the central registry/orchestration launch seam that links worker, run,
  runtime snapshot, and activity identity without copying provider events into
  orchestration rows.

S4-F3 may add group events and projections that reference those authoritative
rows. It must not parse provider streams, copy provider reasoning, infer Runtime
from model vendor, silently fall back, or switch Runtime inside an active run.

## Requirement delta

| Stage 4 requirement                      | Existing Stage 3 primitive                                                                                           | Smallest additive owner                                                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Selectable immutable coordination engine | Durable orchestration row exists, but has one implicit graph scheduler and no engine/version snapshot                | S4-F3-T6 adds engine contract, precedence, capability gate, and legacy mapping                                               |
| Deterministic workflow default           | Dependency scheduler, limits, retries, stops, and ordinary worker runs already exist                                 | S4-F3-T4/T7 add versioned workflow definitions, restricted control flow, checkpoints, schemas, branches, loops, and barriers |
| Codex V2 task-tree mode                  | Durable worker/chat/run lineage can host provider identities                                                         | S4-F3-T8 adds V2 task paths, context forks, mailbox/follow-up, interrupt/list/wait, completion, and residency adapter state  |
| Codex V1 compatibility mode              | Durable worker/chat/run lineage can host legacy provider IDs                                                         | S4-F3-T8 adds explicit V1 ID/nickname lifecycle and honest legacy capability labels                                          |
| Multi-agent runtime activity aggregation | Aggregate status/usage exists, but no provider-neutral activity envelope or runtime provenance                       | S4-F11-T3/T7/T9 provide authoritative activity; S4-F3-T9 adds reference-only group events and projections                    |
| Cross-task orchestration fleet view      | Per-task overview and durable cross-task rows exist                                                                  | S4-F3-T2 adds paginated visible-scope query, filters, and fleet navigation                                                   |
| Accessible rich lineage                  | Spawn/replacement edges and two-way chat navigation exist                                                            | S4-F3-T3 adds graph/tree projection, stale/orphan nodes, engine overlays, messages, and richer keyboard navigation           |
| Safe orchestration policy changes        | Create-time limits and Stage 3 approval/audit gates exist; active policy is not version-editable                     | S4-F3-T4/T6 add optimistic versions, impact preview, tighten/relax classification, and immutable engine policy snapshots     |
| Durable cascading cancellation           | Stop state is committed before the main loop signals runs; restart polling resumes outstanding cancellation requests | S4-F3-T5 adds engine-aware descendant intent, partial-signal/orphan handling, and uncertain provider-action reconciliation   |
| Safe reusable orchestration templates    | Worker definitions are durable only inside one orchestration                                                         | S4-F3-T4 adds redacted reusable worker/policy/workflow definitions and resolved preview                                      |
| Agent profile authority separation       | Stage 3 worker definitions contain capability fields but no reusable profile/personality record                      | S4-F3-T6 preserves the boundary; S4-F12 owns separately versioned capability, presentation, workflow, and Runtime layers     |

## Explicit non-primitives

Stage 3 has durable agent chats and runs. It does **not** have saved multi-agent
operation workspaces, selectable coordination engines, mailboxes/follow-up
queues, versioned workflow scripts/checkpoints, or runtime-aware group activity.
Those remain named additive changes. Saved operation workspace ownership stays
with `add-saved-workspaces`; provider event fidelity stays with S4-F11.

No Stage 3 scheduler, budget, depth, retry, replace, add, pause, resume, stop,
chat, run, or UI behavior needs replacement for this baseline.

## Reference snapshot

The design comparison is pinned, not floating: OpenAI Codex
`d7ba5ff9553a` (Apache-2.0), Claude Code `988b3e564327` (all rights reserved),
Oh My OpenAgent `bb0f6fbb69ca` (Sustainable Use License), and Everything Claude
Code `ed387446052d` (MIT). These are behavior/design references only; this
baseline copies no external source.

# Change: Extend multi-agent operations

## Why

Stage 3 already delivers durable bounded orchestration, budgets, depth, lineage,
and lifecycle controls inside a task. Stage 4 should expose those primitives as
an efficient fleet operating surface and add selectable coordination engines
instead of rebuilding the scheduler.

## What Changes

- Add a cross-task orchestration fleet view and richer accessible lineage graph.
- Add a provider-neutral deterministic workflow engine as the default, plus
  capability-gated Codex task-tree V2 and legacy-thread V1 modes.
- Add global, project, and per-launch engine selection with immutable run snapshots.
- Aggregate the first-class Agent Runtime activity stream into workflow,
  coordination, fleet, lineage, and operation-workspace progress.
- Add inspectable/editable policy for parallelism, depth, spawn, budget, failure,
  blocker, and time limits using the existing approval and audit gate.
- Make descendant cancellation, orphan handling, partial failure, restart state,
  and stale identity visible and recoverable.
- Add reusable orchestration templates that store definitions, never live
  credentials or hidden session authority.
- Bind each orchestration to one task-scoped saved operation workspace containing
  the initiating chat and all descendant agent chats.
- Record a research gate for custom agent profiles/personalities without treating
  the unsettled profile product as implementation-ready.

## Impact

- Affected specs: new `orchestration-operations` capability.
- Affected code: Stage 3 orchestration service/DTOs, engine adapters and workflow
  runtime, Agent Runtime activity projections, task card, fleet/workspace views,
  lineage rendering, Settings policy, MCP controls, audit, and recovery tests.

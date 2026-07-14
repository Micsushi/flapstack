# Change: Extend multi-agent operations

## Why

Stage 3 already delivers durable bounded orchestration, budgets, depth, lineage,
and lifecycle controls inside a task. Stage 4 should expose those primitives as
an efficient fleet operating surface instead of rebuilding the scheduler.

## What Changes

- Add a cross-task orchestration fleet view and richer accessible lineage graph.
- Add inspectable/editable policy for parallelism, depth, spawn, budget, failure,
  blocker, and time limits using the existing approval and audit gate.
- Make descendant cancellation, orphan handling, partial failure, restart state,
  and stale identity visible and recoverable.
- Add reusable orchestration templates that store definitions, never live
  credentials or hidden session authority.

## Impact

- Affected specs: new `orchestration-operations` capability.
- Affected code: Stage 3 orchestration service/DTOs, task card, new fleet view,
  lineage rendering, Settings policy, MCP controls, audit, and recovery tests.

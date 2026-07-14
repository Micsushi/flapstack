## Context

Stage 3 owns the scheduler, worker definitions, queue, budgets, stop conditions,
retry/replace/add, and task card. Stage 4 consumes that service as-is unless a
verified gap requires an additive contract change.

## Goals / Non-Goals

- Goals: fleet visibility, rich navigation, policy editing, cascading control,
  restart recovery, and reusable safe definitions.
- Non-goals: a second scheduler, hosted swarm service, hidden delegation,
  unlimited spawning, or cross-project authority by default.

## Decisions

- Keep `task_orchestrations` and `orchestration_agents` authoritative. Fleet and
  graph views are projections, not another state store.
- Policy changes use optimistic versioning. Tightening limits applies immediately;
  relaxing authority or budget uses the Stage 3 approval/audit gate.
- Stop records durable cancellation intent before signaling runs. Restart resumes
  cancellation reconciliation, never work execution.
- Orphans remain attached to the orchestration and display the missing parent;
  they are never silently reparented.
- Templates contain prompts/specs, harness/model preferences, dependencies,
  limits, and worktree strategy, but no credentials, session grants, or live IDs.

## Risks / Trade-offs

- Fleet controls can amplify mistakes. Require exact target counts, impact
  preview, bounded selection, and audit.
- Existing Stage 3 live proof remains open. S4-F3-T1 blocks implementation until
  shipped behavior and remaining evidence are reconciled.

## Migration Plan

Add view preferences/templates and policy versions additively. Existing Stage 3
orchestrations appear automatically. Rollback removes new UI/state without
changing queues or worker history.

## Open Questions

- None blocking after S4-F3-T1. Default fleet actions target one orchestration;
  multi-select actions require a separate exact-impact confirmation.

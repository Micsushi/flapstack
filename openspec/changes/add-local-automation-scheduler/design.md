## Context

`automations.ts` validates disabled drafts; `create_automation_draft` already
persists non-runnable intent. The inherited renderer expects hosted APIs and is
only a visual starting point. Stage 3 supplies approval, audit, run launch, and
bounded orchestration.

## Goals / Non-Goals

- Goals: durable local scheduling, explicit authority, restart safety, dry-run,
  budgets, retry, kill, history, notifications, and scoped MCP management.
- Non-goals: hosted scheduling, OS launch agents/services, arbitrary webhook
  ingress, silent agent activation, or replacing task orchestration.

## Decisions

- Run one scheduler inside Electron main while Flapstack is open. Persist next
  fire time and leases; missed runs are evaluated at startup. No OS scheduler.
- Initial triggers: manual, cron-like schedule, run-complete, and registered-root
  file change. File events debounce and coalesce by automation/scope.
- Missed-run default is one catch-up execution, never replay every missed tick.
- Automation creates or targets a chat/task/run through shared services. It does
  not bypass permissions, checkpoints, manifests, usage, or orchestration limits.
- Agent-created automation remains a draft until user approval. Enabling or
  increasing authority/budget uses Stage 3 approval and audit.
- Default retry: no retry. Optional bounded exponential retry has max attempts
  and wall-clock deadline. A lease prevents duplicate execution.
- Dry-run resolves trigger, target, permissions, prompt, worktree, and budget but
  launches nothing and writes no project files.

## Risks / Trade-offs

- Main-process scheduling does not run while Flapstack is closed. UI states this
  clearly; an OS daemon is a later explicit decision, not hidden scope.
- File triggers can storm. Registered-root validation, debounce, ignore rules,
  coalescing, and per-automation concurrency=1 are defaults.
- Automated tools amplify authority. Exact preview, approval, budget, stop, and
  audit are required before enablement.

## Migration Plan

Add tables without activating existing drafts. Hosted-era records are not
imported automatically. Existing MCP drafts remain disabled until reviewed.

## Open Questions

- None blocking. Defaults above favor one in-app scheduler and bounded behavior.

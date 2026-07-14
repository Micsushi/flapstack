# Change: Add a local automation scheduler

## Why

Flapstack exposes non-runnable automation drafts and inherited hosted-era UI,
but cannot execute durable local automations. Stage 4 needs bounded scheduling
that reuses existing run, approval, audit, usage, and orchestration contracts.

## What Changes

- Add local automation, trigger, execution, lease, retry, budget, and inbox records.
- Add one main-process scheduler with restart recovery and no OS-level daemon.
- Support manual, schedule, run-complete, and scoped file-change triggers.
- Keep agent-created automations disabled until explicitly approved.
- Add dry-run, pause, kill, retry, history, notification, and MCP management.

## Impact

- Affected specs: new `local-automation` capability.
- Affected code: automation router/UI, database/migrations, Electron lifecycle,
  run launch/orchestration, MCP gate/audit, usage budgets, notifications, and tests.

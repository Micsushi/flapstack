# S4-F5 — Automation and Scheduler

- Outcome: local recurring and event-triggered runs with approval, dry-run,
  budgets, history, retry policy, notifications, and a kill switch.
- Change: `openspec/changes/add-local-automation-scheduler/`
- Tasks: `openspec/changes/add-local-automation-scheduler/tasks.md`
- Task IDs: S4-F5-T1 through S4-F5-T8
- Starting point: inherited hosted-era automation UI only; backend must be
  rebuilt local-first.
- Dependencies: Stage 3 approval/audit and stable S4-F3 orchestration controls.
- Safety boundary: agent-created automation stays inactive until approved.

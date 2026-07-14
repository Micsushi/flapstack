## Context

The usage store already preserves raw provider observations, cost quality,
accounts, cycles, provider state, alerts, and run IDs. Advanced scope attribution
must not double-count provider totals and Flapstack-run samples.

## Goals / Non-Goals

- Goals: durable attribution, reconciled rollups, honest forecasts, budget policy,
  alerts, explorer/export, and integration with automated work.
- Non-goals: inventing subscription quota APIs, exact billing from estimates,
  hosted analytics, or storing provider credentials/raw secrets.

## Decisions

- Snapshot project/task/chat/harness/automation/orchestration attribution when a
  run sample is written so later rename/archive/delete does not rewrite history.
- Provider/account totals and Flapstack-run usage are separate source classes.
  `All visible usage` never sums overlapping classes without dedupe/reconciliation.
- Rollups are computed from normalized samples/cycles and cached only as a
  rebuildable optimization. Raw facts remain authoritative.
- Budget scopes: global, provider/account, project, task, automation, and
  orchestration. Hard stops apply only where Flapstack controls launches/runs;
  external provider usage can alert but cannot be stopped.
- Forecasts require minimum sample coverage and display confidence/quality.
  Missing/estimated data yields ranges or unavailable state, not false precision.
- Exports are CSV/JSON summaries plus provenance; raw payload export is explicit
  and redacted.

## Risks / Trade-offs

- Double counting is the primary risk. Every query carries source class and
  dedupe rules; reconciliation tests compare rollups to raw samples.
- Historical provider data can be sparse. Forecasts fail unavailable below the
  coverage threshold.
- Budgets can interrupt work. Preview scope, remaining amount, reset, and exact
  stop behavior before enabling a hard limit.

## Migration Plan

Backfill attribution from retained run/chat/task rows where possible. Mark
unrecoverable dimensions unknown. Existing samples and alerts remain unchanged.

## Open Questions

- None blocking. Raw facts remain authoritative; cached rollups are rebuildable.

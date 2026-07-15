# Change: Extend advanced usage and limits

## Why

Stage 2/3 captures provider and run usage, but users still need durable
attribution and rollups across accounts, harnesses, projects, tasks, chats,
automations, and orchestrations with budget/headroom decisions.

## What Changes

- Add durable usage attribution snapshots and saved budget definitions.
- Add rollup/query contracts across all product scopes and time windows.
- Add headroom, burn-rate, forecast, and anomaly calculations with provenance.
- Extend daemon alerts and automation/orchestration budget enforcement.
- Add an advanced explorer, comparison, and redacted export surface.

## Impact

- Affected specs: new `advanced-usage-limits` capability.
- Affected code: usage schema/store/engine/alerts, run capture, rollup services,
  dashboard, automation/orchestration budgets, export, and tests.

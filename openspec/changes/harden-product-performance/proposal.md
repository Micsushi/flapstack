# Change: Harden product performance and scale

## Why

Flapstack needs repeatable performance budgets before public release across
large projects, long chats, many windows, background services, terminals, and
concurrent agents.

## What Changes

- Define representative datasets, hardware classes, metrics, and budgets.
- Add deterministic benchmark, trace, heap, database, and soak harnesses.
- Optimize startup, renderer, storage/search, streaming, background work, and concurrency.
- Add regression gates and published support limits.

## Impact

- Affected specs: new product-performance capability.
- Affected code: startup, renderer, state/query, SQLite, search, terminals,
  agent streaming, daemons, workspaces, diagnostics, CI/local harnesses, and docs.

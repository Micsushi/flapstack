## Context

Stage 2 reports a green strict baseline, while older Stage 3 planning describes
inherited TypeScript and native ABI debt. Current evidence decides the truth.

## Goals / Non-Goals

- Goals: zero TypeScript errors, reproducible native setup, one green commit
  gate, and explicit debt disposition.
- Non-goals: MCP features, unrelated refactors, or UI polish.

## Decisions

- Audit current `main`; do not assume old branch findings still apply.
- Fix all TypeScript errors, not only files touched by Stage 3.
- `npm run check` remains the commit gate and includes strict TypeScript.
- Debt is deferred only when proven non-blocking and assigned a destination.

## Risks / Trade-offs

- Broad fixes can create churn. Keep changes minimal and prove focused behavior.

## Migration Plan

No data migration is expected. Any discovered schema work becomes an explicit
task with temporary-database verification.

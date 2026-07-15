## Context

Feature-level evidence cannot substitute for an integrated exact-SHA release.
External credentials/devices/platforms remain explicit gates, not assumed passes.

## Goals / Non-Goals

- Goals: one candidate, complete crosswalk, clean/upgrade proof, integrated user
  workflow, independent review, truthful limitations, and reversible release decision.
- Non-goals: merging/pushing/publishing without separate user authority, hiding
  unavailable evidence, or reopening lower-priority polish endlessly.

## Decisions

- F1-F10 and F12 task boards and exits must be complete before final candidate freeze.
- Candidate ledger maps every matrix row to current-SHA evidence.
- Fixture/headless evidence cannot close required live/device/provider/platform rows.
- Review/fix rounds reopen P0/P1 and acceptance blockers immediately; lower
  issues require explicit release triage.
- Release action, merge, push, tag, and publication require separate explicit authorization.

## Migration Plan

No product migration owned here; this change validates all migrations and
documents rollback/recovery from Stage 4 and clean install, including the
typed-section to knowledge-graph migration and index rebuild.

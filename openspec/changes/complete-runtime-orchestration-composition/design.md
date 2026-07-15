## Context

F11 alone owns adapter selection, provider process/protocol, controls, and native
activity. F3 owns workflow scheduling, coordination, policy, and projections.

## Goals / Non-Goals

- Goals: one provider authority, typed consumer ports, schema propagation,
  truthful pause/resume, ordered activity, and restart-safe no-replay.
- Non-goals: second provider client, copied activity rows, synthetic native
  features, or generic fallback that hides incompatibility.

## Decisions

- F3 requests coordination through versioned F11 ports; F11 selects/validates adapter.
- Structured output is a launch capability. Unsupported required schema blocks before claim.
- Pause/resume is optional capability with exact per-run result; unsupported is not simulated.
- F11 activity remains authoritative; F3 stores references/high-water and adds
  workflow-only events.
- Reservations and checkpoint attempts preserve exact run/agent/definition identity.
- Recovery never launches historical terminal/running work as a new attempt.

## Migration Plan

Additive port/version fields and activity references. Existing Stage 4 snapshots
remain valid. Capability off retains current fail-closed behavior.

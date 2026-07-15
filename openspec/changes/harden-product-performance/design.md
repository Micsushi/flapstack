## Context

Benchmarks must distinguish cold/warm, development/packaged, fixture/live,
hardware class, and exact build. Optimization cannot weaken durability or truth.

## Goals / Non-Goals

- Goals: repeatable budgets, representative scale, actionable traces, bounded
  resources, regression detection, and honest support limits.
- Non-goals: benchmark marketing, optimizing synthetic paths only, hiding work,
  dropping events/messages, or weakening persistence/security.

## Decisions

- T1 establishes budgets from baseline plus product targets before optimization.
- Fixture tiers cover small, medium, large, and stress projects/chats/agents.
- Metrics include startup, interaction latency, frame/task stalls, query time,
  stream throughput, CPU, memory, process count, file descriptors, and cleanup.
- Gates run deterministic subsets in CI/local check; long soak and hardware
  matrices are scheduled/manual evidence.
- Regressions require explicit approved budget change with evidence.

## Migration Plan

Instrumentation is disabled or low-overhead in normal production. Performance
schema/trace artifacts are separate from user data and redact content.

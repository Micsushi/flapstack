## ADDED Requirements

### Requirement: Versioned performance budgets

Flapstack SHALL define versioned budgets by scenario, dataset, hardware class,
platform, build type, metric, measurement method, and allowed variance.

#### Scenario: Baseline changes materially

- **WHEN** a required metric exceeds budget
- **THEN** the gate fails unless an evidence-backed budget change is reviewed

### Requirement: Representative deterministic harnesses

Flapstack SHALL provide deterministic fixtures and measurement harnesses for
startup, renderer, storage/search, streaming, background services, and concurrency.

#### Scenario: Large-chat render benchmark runs

- **WHEN** the fixed fixture is measured
- **THEN** result records exact SHA/platform/hardware/build and comparable metrics

### Requirement: No performance-driven truth loss

Flapstack SHALL NOT meet performance budgets by dropping durable messages,
activity, audit, checkpoints, errors, permissions, or recovery state.

#### Scenario: Stream backpressure activates

- **WHEN** renderer cannot consume immediately
- **THEN** events remain bounded, ordered, persisted, and visibly recoverable

### Requirement: Bounded lifecycle resources

Flapstack SHALL release processes, listeners, workers, terminals, subscriptions,
files, and memory after workflows close, cancel, archive, or restart.

#### Scenario: Multi-agent soak completes

- **WHEN** all agents and terminals stop
- **THEN** resource counts return within the documented steady-state envelope

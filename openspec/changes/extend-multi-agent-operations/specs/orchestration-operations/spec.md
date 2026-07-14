## ADDED Requirements

### Requirement: Cross-task orchestration fleet view

Flapstack SHALL show active and terminal orchestrations across visible projects
using the existing durable orchestration state.

#### Scenario: Review active fleet

- **WHEN** multiple tasks contain queued, running, paused, or terminal orchestrations
- **THEN** the fleet view shows honest aggregate state, limits, blockers, usage
  provenance, and navigation without replaying completed work

### Requirement: Accessible rich lineage

Flapstack SHALL render spawn and replacement lineage with keyboard-accessible
navigation and explicit stale or orphan nodes.

#### Scenario: Parent chat is missing

- **WHEN** a descendant remains but its parent chat is missing or archived
- **THEN** the graph preserves the original edge, marks the parent stale, and
  does not silently reparent the descendant

### Requirement: Safe orchestration policy changes

Flapstack SHALL version policy changes and use existing approval and audit rules
when a change increases authority, concurrency, depth, or budget.

#### Scenario: Increase spawn depth

- **WHEN** a user or agent requests a higher maximum depth
- **THEN** Flapstack previews the current and proposed limits and applies the
  change only after the required approval succeeds

### Requirement: Durable cascading cancellation

Flapstack SHALL record cancellation intent before signaling active descendants
and SHALL resume reconciliation after restart.

#### Scenario: App exits during cancellation

- **WHEN** Flapstack restarts after recording stop intent but before every child exits
- **THEN** it continues cancellation reconciliation and does not launch or replay work

### Requirement: Safe reusable orchestration templates

Flapstack SHALL allow reusable worker and policy definitions without persisting
credentials, session grants, live run IDs, or hidden caller authority.

#### Scenario: Start from a template

- **WHEN** a user applies a template to a project or task
- **THEN** Flapstack previews resolved harnesses, permissions, worktrees,
  dependencies, and limits before creating the orchestration

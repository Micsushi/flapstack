## ADDED Requirements

### Requirement: Durable local automation definitions

Flapstack SHALL persist automation trigger, target, prompt, harness, model,
permissions, worktree, budget, retry, enabled state, and approval provenance.

#### Scenario: Agent creates an automation draft

- **WHEN** an authorized agent proposes an automation
- **THEN** Flapstack persists a non-runnable draft and requires user approval
  before enablement

### Requirement: Restart-safe main-process scheduling

Flapstack SHALL lease due executions transactionally and recover after restart
without duplicating or replaying completed work.

#### Scenario: App restarts after a due execution was leased

- **WHEN** a lease expires without a terminal execution record
- **THEN** Flapstack reconciles the attempt according to retry policy and never
  launches two executions for the same trigger occurrence

### Requirement: Bounded trigger catalog

Flapstack SHALL support manual, schedule, run-complete, and registered-root
file-change triggers with scoped validation and coalescing.

#### Scenario: File event storm

- **WHEN** many matching file events occur inside one debounce window
- **THEN** Flapstack creates at most one pending occurrence for that automation

### Requirement: Shared run authority and evidence

Automation execution SHALL use shared task/chat/run services, permission gates,
checkpoints, manifests, usage capture, and audit.

#### Scenario: Automation requests unavailable authority

- **WHEN** resolved permissions do not authorize the configured action
- **THEN** execution stops before launch and records an actionable denied result

### Requirement: Dry-run and lifecycle control

Flapstack SHALL preview resolved execution without launching and SHALL support
pause, resume, kill, bounded retry, and history.

#### Scenario: Dry-run requested

- **WHEN** a user dry-runs an enabled automation
- **THEN** Flapstack shows trigger, target, prompt, permissions, worktree, and
  budget while creating no run and changing no project file

### Requirement: Honest closed-app behavior

Flapstack SHALL state that Stage 4 automations run only while the desktop app is
open and SHALL perform at most one configured catch-up occurrence at startup.

#### Scenario: Several schedule ticks pass while app is closed

- **WHEN** Flapstack starts after several missed ticks
- **THEN** it queues zero or one catch-up occurrence according to policy and does
  not replay every missed tick

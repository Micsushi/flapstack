## ADDED Requirements

### Requirement: Selectable immutable coordination engine

Flapstack SHALL resolve one coordination engine from per-launch, project, global,
and product-default settings and SHALL persist the resolved engine/version on the
orchestration before work starts.

#### Scenario: User has not selected an engine

- **WHEN** a user starts an orchestration without a per-launch or project override
- **THEN** Flapstack selects the global value or the `workflow` product default,
  previews the resolved behavior, and stores an immutable engine snapshot

#### Scenario: Requested engine is unavailable

- **WHEN** a saved project override requires a Codex mode whose capability probe fails
- **THEN** Flapstack blocks launch with the exact missing capability and does not
  silently fall back to another engine

### Requirement: Deterministic workflow default

Flapstack SHALL provide a provider-neutral workflow engine whose restricted,
versioned control program owns phases, branches, loops, barriers, structured
intermediate results, concurrency, and checkpoints while workers perform all
filesystem, shell, network, and MCP actions through ordinary runs.

#### Scenario: Resume an interrupted workflow

- **WHEN** a workflow restarts after some required steps completed durably
- **THEN** completed step results are reused, unfinished steps resume or retry by
  explicit policy, and no completed worker is relaunched implicitly

#### Scenario: Required review dimension fails

- **WHEN** one required parallel reviewer fails or returns invalid structured output
- **THEN** the barrier records an incomplete result and cannot report a clean pass

### Requirement: Codex V2 task-tree mode

Flapstack SHALL support a capability-gated Codex V2 adapter for named task paths,
selective context forks, queued messages, follow-up turns, mailbox delivery,
interrupt-without-destroy, listing, completion envelopes, and safe residency.

#### Scenario: Follow up with a completed V2 worker

- **WHEN** a user sends a follow-up task to a completed worker whose rollout is durable
- **THEN** Flapstack reuses or reloads that worker according to provider capability,
  records the new turn, and preserves its canonical task identity

### Requirement: Codex V1 compatibility mode

Flapstack SHALL expose Codex V1 as an advanced legacy mode and SHALL preserve its
ID-based spawn, send/interrupt, final-status wait, resume, and close semantics
without presenting unavailable V2 features.

#### Scenario: Inspect a V1 orchestration

- **WHEN** a V1 worker has only a provider agent ID and optional nickname
- **THEN** Flapstack shows that identity honestly and does not synthesize a V2 task path

### Requirement: Multi-agent runtime activity aggregation

Flapstack SHALL project durable Agent Runtime events into workflow, fleet,
lineage, and workspace activity without copying or relabeling provider reasoning.

#### Scenario: Mixed-runtime workflow reports progress

- **WHEN** Codex, Claude Code, and Flapstack Native workers run in one workflow
- **THEN** the operation timeline preserves each worker/runtime provenance and
  adds ordered workflow, dependency, mailbox, spawn, warning, and usage events

#### Scenario: Flapstack generates a progress summary

- **WHEN** group activity is condensed into user-facing prose
- **THEN** it is labeled `Activity summary` and never presented as provider
  reasoning or private chain-of-thought

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
  dependencies, engine, workflow phases, output schemas, and limits before
  creating the orchestration

### Requirement: Agent profile authority separation

Flapstack SHALL treat presentation personality/style as separate from capability,
permission, memory, model, and workflow definitions in every template or future
profile record.

#### Scenario: Apply a named personality style

- **WHEN** a presentation style is attached to an agent definition
- **THEN** it can change tone and formatting only and cannot grant tools,
  permissions, secrets, memory, descendants, or a stronger model

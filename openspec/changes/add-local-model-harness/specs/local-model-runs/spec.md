## ADDED Requirements

### Requirement: Honest local model discovery

Flapstack SHALL discover Ollama availability, installed models, context metadata,
and declared/probed chat, streaming, tool, and vision support without inference.

#### Scenario: Model lacks tool support

- **WHEN** a selected model cannot use tools
- **THEN** Flapstack allows chat-only execution and visibly disables agent-tool tiers

### Requirement: Persisted local model runs

Flapstack SHALL stream local responses into normal chat/run records with model
identity, permission snapshot, context evidence, cancellation, and terminal state.

#### Scenario: Local run is cancelled

- **WHEN** the user cancels a streaming local run
- **THEN** provider streaming stops, the run becomes cancelled, and completed
  content/evidence remains durable

### Requirement: Bounded provider-neutral tool loop

Flapstack SHALL cap local tool iterations, calls, context, output, and wall time
and SHALL fail unknown or malformed tool calls closed.

#### Scenario: Model repeats tool calls indefinitely

- **WHEN** the model reaches a configured loop limit
- **THEN** Flapstack stops the loop and records a bounded-limit terminal reason

### Requirement: Permission-gated local tools

Flapstack SHALL expose read, project-write, shell/git, and network tools only
when the selected model/runtime supports them and resolved permissions authorize them.

#### Scenario: Project-only write escapes the registered root

- **WHEN** a tool path or symlink resolves outside the selected registered worktree
- **THEN** Flapstack rejects the write before mutation and records the denial

### Requirement: Normal evidence and usage

Local runs SHALL create checkpoints, manifests, tool/approval evidence, and
honest token/cost-quality records using shared Flapstack contracts.

#### Scenario: Ollama omits token counts

- **WHEN** the provider response lacks trustworthy usage fields
- **THEN** Flapstack stores unknown usage rather than zero or an estimate presented as exact

### Requirement: Local orchestration participation

Flapstack SHALL allow an eligible local harness in saved workspaces and bounded
orchestration without granting authority beyond its run snapshot.

#### Scenario: Orchestration selects a chat-only model for a tool task

- **WHEN** completion requires tools unsupported by the selected local model
- **THEN** launch fails preflight with an actionable limitation before work starts

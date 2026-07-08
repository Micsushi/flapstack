# agent-runs Specification

## Purpose

TBD - created by archiving change add-stage1-workspace-core. Update Purpose after archive.

## Requirements

### Requirement: Unified Agent Run Records

The system SHALL persist an `agent_runs` record for every Codex and Claude
Code launch, capturing harness, model, resolved permission mode, worktree
path, prompt message reference, status, and start/completion timestamps.

#### Scenario: Run record on launch

- **WHEN** an agent run is launched from any chat
- **THEN** a run record exists before the harness starts, with status
  `running` and the resolved permission mode and worktree recorded

#### Scenario: Run completion status

- **WHEN** a run finishes, fails, or is cancelled
- **THEN** the run record's status and completion timestamp are updated
  accordingly

### Requirement: Assistant Message Identity

Every assistant message SHALL carry the harness and model that produced it,
and the UI SHALL display this identity on messages and chat tabs.

#### Scenario: Message shows producer

- **WHEN** an assistant message is rendered
- **THEN** the message displays the harness and model from its stored
  metadata

#### Scenario: Unknown identity degrades visibly

- **WHEN** a message predates identity tracking
- **THEN** the UI shows an explicit unknown/gray identity rather than
  guessing

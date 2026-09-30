## ADDED Requirements

### Requirement: Scope-Based Worktree Defaults

The system SHALL resolve the default run checkout by chat scope: project
chats use the project checkout, task chats use the task primary worktree, and
global chats have no checkout unless one is explicitly assigned.

#### Scenario: Project chat default

- **WHEN** a run launches from a project chat without an override
- **THEN** the run executes in the project checkout

#### Scenario: Global chat has no checkout

- **WHEN** a global chat with no assigned checkout attempts a run requiring a
  worktree
- **THEN** the user is asked to assign a checkout instead of the system
  picking one silently

### Requirement: Worktree Override

The user SHALL be able to override the run worktree from a dropdown listing
the project checkout, task primary worktree, other known worktrees, and a
custom path; the selected worktree SHALL be recorded on the run.

#### Scenario: Override changes run target

- **WHEN** the user selects a non-default worktree and launches a run
- **THEN** the run executes in the selected worktree and the run record
  stores that path

#### Scenario: Non-default chip

- **WHEN** a chat's selected worktree differs from its scope default
- **THEN** a visible chip indicates the non-default worktree

### Requirement: Honest Worktree State

If the current worktree state cannot be inferred safely, the UI SHALL show an
explicit unknown/needs-refresh state rather than a guessed value.

#### Scenario: Detection failure

- **WHEN** the current branch or worktree status cannot be read
- **THEN** the UI shows unknown/needs-refresh for that chat

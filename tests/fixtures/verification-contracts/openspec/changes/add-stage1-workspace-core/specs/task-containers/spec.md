## ADDED Requirements

### Requirement: Tasks As Context Containers

The system SHALL provide tasks as folder-like work areas inside projects,
holding a name, description, status, default permission mode, chats, and
attachments/artifacts.

#### Scenario: Create a task

- **WHEN** a user creates a task inside a project
- **THEN** the task is persisted with its project reference and copies the
  project's current default permission mode

#### Scenario: List task chats

- **WHEN** a user opens a task
- **THEN** the task's chats are listed separately from project-level and
  global chats

### Requirement: Task Primary Worktree

Each task SHALL have one shared primary worktree, created lazily on first
use, that task chats use as their default checkout.

#### Scenario: Lazy worktree creation

- **WHEN** the first agent run launches in a task chat and the task has no
  primary worktree yet
- **THEN** the system creates a worktree on a task-named branch and persists
  its path and branch on the task

#### Scenario: Shared across task chats

- **WHEN** a second chat in the same task launches a run without a worktree
  override
- **THEN** the run uses the same task primary worktree

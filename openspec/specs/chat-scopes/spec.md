# chat-scopes Specification

## Purpose

TBD - created by archiving change add-stage1-workspace-core. Update Purpose after archive.

## Requirements

### Requirement: Chat Scope Model

The system SHALL support chats in exactly one of three scopes: `global` (no
project), `project` (bound to a project), or `task` (bound to a task within a
project), and SHALL validate scope/foreign-key consistency on creation.

#### Scenario: Create a global chat

- **WHEN** a user creates a chat with no project selected
- **THEN** the chat is stored with scope `global`, no `projectId`, no
  `taskId`, and no worktree

#### Scenario: Create a task chat

- **WHEN** a user creates a chat inside a task
- **THEN** the chat is stored with scope `task`, the task's `projectId`, and
  the task's `taskId`

#### Scenario: Reject inconsistent scope

- **WHEN** a chat creation request declares scope `task` but provides no
  `taskId`
- **THEN** the request fails with a validation error and no chat is created

### Requirement: Chat Scope Moves

The system SHALL allow moving chats between adjacent scopes: global → project,
project → task, and task → project, updating scope, references, and the
default worktree, while never rewriting the chat's copied permission mode.

#### Scenario: Promote a global chat to a project

- **WHEN** a user attaches a global chat to a project
- **THEN** the chat's scope becomes `project`, its `projectId` is set, and
  its default worktree resolves to the project checkout

#### Scenario: Detach a task chat back to its project

- **WHEN** a user detaches a task chat from its task
- **THEN** the chat's scope becomes `project`, `taskId` is cleared, and the
  chat's existing permission mode is unchanged

### Requirement: Existing Chats Migration

Existing chats SHALL migrate to scope `project` with their messages, worktree
paths, and archive state preserved.

#### Scenario: Migration preserves data

- **WHEN** the schema migration runs on a database with existing chats
- **THEN** every existing chat has scope `project` and identical message
  content, worktree path, and archive state as before

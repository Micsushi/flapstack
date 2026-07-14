# workspace-lifecycle Specification

## Purpose

TBD - created by archiving change add-stage1-workspace-core. Update Purpose after archive.

## Requirements

### Requirement: Pin And Archive Lifecycle

Projects, tasks, and chats SHALL each support pin/unpin and archive/restore;
archived items SHALL leave default navigation and default search results.

#### Scenario: Archive hides from navigation

- **WHEN** a user archives a task
- **THEN** the task and its chats no longer appear in default navigation

#### Scenario: Pinned items surface

- **WHEN** a user pins a chat
- **THEN** the chat appears in the pinned section across restarts

### Requirement: Archives View And Undo

The system SHALL provide an archives view listing archived projects, tasks,
and chats with restore actions, and a short undo window after every archive
action.

#### Scenario: Undo after archive

- **WHEN** a user archives a chat and activates undo within the offered
  window
- **THEN** the chat is restored to its previous location and state

#### Scenario: Restore from archives view

- **WHEN** a user restores a project from the archives view
- **THEN** the project reappears in default navigation with its tasks and
  chats intact

### Requirement: Open Active Workspace In An External Editor

The system SHALL expose an Open In control in the shared desktop conversation header for every agent provider. The control SHALL target the active conversation's resolved local worktree or project folder and SHALL use the existing preferred-editor action and editor menu.

#### Scenario: Open a local conversation folder

- **WHEN** a user activates a conversation with a resolved local folder and selects the header's primary Open In action
- **THEN** the system opens that folder in the user's preferred editor

#### Scenario: Choose another editor

- **WHEN** a user opens the header control's menu and selects an available editor
- **THEN** the system opens the active conversation folder in that editor and preserves the existing preferred-editor behavior

#### Scenario: Provider-independent availability

- **WHEN** a local conversation is rendered for any supported agent provider
- **THEN** the same shared Open In control is available without provider-specific behavior

#### Scenario: No local folder

- **WHEN** the active conversation has no resolved local folder
- **THEN** the Open In control is disabled and does not attempt to launch an editor

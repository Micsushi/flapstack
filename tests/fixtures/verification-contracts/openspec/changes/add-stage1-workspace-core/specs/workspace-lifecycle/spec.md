## ADDED Requirements

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

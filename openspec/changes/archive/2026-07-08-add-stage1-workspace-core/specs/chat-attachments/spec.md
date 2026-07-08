## ADDED Requirements

### Requirement: Persistent Chat Attachments

The system SHALL persist chat attachments (dropped files, images, and pasted
text) with their metadata and stored content, keeping the original chat
attachment immutable for history.

#### Scenario: Drag and drop persists

- **WHEN** a user drops a file into a chat and sends the message
- **THEN** an attachment record exists with kind, name, and a stored copy

#### Scenario: Pasted text becomes an attachment

- **WHEN** a user pastes a large text block
- **THEN** it can be stored as a text attachment associated with the chat

### Requirement: Explicit Attachment Promotion

Attachments SHALL be promotable to task artifacts and writable into the
selected worktree only through explicit user actions.

#### Scenario: Promote to task artifact

- **WHEN** a user chooses "add to task artifacts" on an attachment in a task
  chat
- **THEN** the attachment is associated with the task and listed among its
  artifacts

#### Scenario: Write to worktree requires explicit action

- **WHEN** a user chooses "write to worktree" and confirms the target path
- **THEN** the file is written into the selected worktree
- **AND** no attachment is ever written to disk without that explicit action

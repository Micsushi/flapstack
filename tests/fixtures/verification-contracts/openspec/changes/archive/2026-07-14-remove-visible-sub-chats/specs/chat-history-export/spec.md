## MODIFIED Requirements

### Requirement: Handoff Transcript Format

The copied full-history transcript SHALL be suitable for pasting into another
agent chat as context and SHALL describe each sidebar chat as one conversation.
Hidden legacy conversation records MAY be included in a clearly labeled legacy
recovery section so existing data is not lost.

#### Scenario: Include complete chat content

- **GIVEN** a chat has one visible conversation
- **WHEN** the user copies a full chat history
- **THEN** the transcript includes chat metadata such as chat name, scope,
  project or task when available, branch or worktree when available, and export
  time
- **AND** it includes every message in the visible conversation in
  chronological order
- **AND** it does not describe newly created chats as containing sub-chats

#### Scenario: Include concise tool context

- **GIVEN** messages contain tool calls, file edits, command execution, or other
  non-text parts
- **WHEN** the user copies the full chat history
- **THEN** the transcript includes concise summaries of those non-text parts
- **AND** file paths and command text are preserved when available
- **AND** bulky tool payloads are summarized rather than dumped verbatim

#### Scenario: Preserve hidden legacy content

- **GIVEN** a chat contains hidden legacy conversation records
- **WHEN** the user copies the full chat history
- **THEN** the export may include those records in a clearly labeled legacy
  recovery section
- **AND** no stored legacy message is deleted or modified

#### Scenario: Exclude hidden attachment payloads

- **GIVEN** a current or legacy development message contains a hidden
  `file-content` part
- **WHEN** the message is rendered or copied as full history or JSON
- **THEN** the hidden attachment body is removed before renderer or clipboard
  serialization
- **AND** visible metadata may identify the attachment without revealing its
  content

## ADDED Requirements

### Requirement: Full Chat History Clipboard Copy

The system SHALL provide a direct action to copy a full chat-history handoff for
any local chat.

#### Scenario: Copy from sidebar context menu

- **GIVEN** a local chat appears in the left sidebar
- **WHEN** the user opens the chat context menu
- **THEN** the menu includes "Copy full chat history"
- **AND** selecting it writes the full handoff transcript for that chat to the
  clipboard

#### Scenario: Copy current chat from active chat menu

- **GIVEN** a local chat is currently open
- **WHEN** the user opens the active-chat menu or top-level chat actions menu
- **THEN** the menu includes an action to copy the current chat's full history
- **AND** selecting it writes the full handoff transcript for that chat to the
  clipboard

### Requirement: Handoff Transcript Format

The copied full-history transcript SHALL be suitable for pasting into another
agent chat as context.

#### Scenario: Include complete chat content

- **GIVEN** a chat has one or more sub-chats
- **WHEN** the user copies the full chat history
- **THEN** the transcript includes chat metadata such as chat name, scope,
  project or task when available, branch or worktree when available, and export
  time
- **AND** the transcript includes every sub-chat in creation order
- **AND** the transcript includes every message in chronological order
- **AND** text message parts are copied without intentional truncation

#### Scenario: Include concise tool context

- **GIVEN** messages contain tool calls, file edits, command execution, or other
  non-text parts
- **WHEN** the user copies the full chat history
- **THEN** the transcript includes concise summaries of those non-text parts
- **AND** file paths and command text are preserved when available
- **AND** bulky tool payloads are summarized rather than dumped verbatim

### Requirement: Clipboard Feedback

The system SHALL tell the user whether the full-history copy action succeeded or
failed.

#### Scenario: Copy succeeds

- **WHEN** the transcript is written to the clipboard
- **THEN** the app shows a success toast

#### Scenario: Copy fails

- **WHEN** the transcript cannot be written to the clipboard
- **THEN** the app shows a failure toast with a clear reason when available
- **AND** the chat history remains unchanged

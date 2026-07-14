# chat-history-export Specification

## Purpose

TBD - created by archiving change add-copy-chat-history. Update Purpose after archive.

## Requirements

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

### Requirement: User Message Clipboard Copy

The system SHALL provide a copy action for each user-sent text message.

#### Scenario: Copy a sent message

- **GIVEN** a user text message appears in the transcript
- **WHEN** the user selects its copy action
- **THEN** the displayed message text is written to the clipboard
- **AND** the chat history remains unchanged

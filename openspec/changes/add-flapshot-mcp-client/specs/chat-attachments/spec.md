## MODIFIED Requirements

### Requirement: Persistent Chat Attachments

The system SHALL persist chat attachments with their metadata and stored content or a
validated bounded local reference, keeping copied chat content immutable and preserving
external media provenance and integrity state.

#### Scenario: Drag and drop persists

- **WHEN** a user drops a file into a chat and sends the message
- **THEN** an attachment record exists with kind, name, and a stored copy

#### Scenario: Pasted text becomes an attachment

- **WHEN** a user pastes a large text block
- **THEN** it can be stored as a text attachment associated with the chat

#### Scenario: Validated external media reference persists

- **WHEN** an approved external MCP operation returns media above the copy threshold
- **THEN** the attachment stores its canonical local reference, MIME, size, hash, provenance,
  and integrity state
- **AND** later missing or tampered state is detectable

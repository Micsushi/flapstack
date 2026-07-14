# chat-message-timestamps Specification

## Purpose

TBD - created by archiving change add-message-timestamps. Update Purpose after archive.

## Requirements

### Requirement: Transcript Message Timestamps

The system SHALL display a local timestamp for user and assistant messages.

#### Scenario: Message sent today

- **WHEN** a transcript message was sent on the current local date
- **THEN** its timestamp shows the local time without repeating the date

#### Scenario: Older message

- **WHEN** a transcript message was sent before the current local date
- **THEN** its timestamp shows the full local date and time

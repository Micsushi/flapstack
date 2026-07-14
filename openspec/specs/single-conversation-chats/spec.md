# single-conversation-chats Specification

## Purpose

TBD - created by archiving change remove-visible-sub-chats. Update Purpose after archive.

## Requirements

### Requirement: One Visible Conversation Per Sidebar Chat

The system SHALL present each chat item in the left sidebar as exactly one
conversation.

#### Scenario: Open a sidebar chat

- **WHEN** a user selects a chat in the left sidebar
- **THEN** the main area opens that chat's single visible conversation
- **AND** no nested chat tabs or nested chat selector are shown

#### Scenario: Create a chat

- **WHEN** a user creates a chat from a global, project, or task scope
- **THEN** one sidebar chat and one visible conversation are created
- **AND** the user is not offered a control to create a nested chat

### Requirement: No Nested Chat Navigation

The system SHALL NOT expose sub-chat creation, history, quick-switch, split,
pin, archive, or direct-selection controls in the normal chat interface.

#### Scenario: Inspect active chat controls

- **WHEN** a user opens a chat
- **THEN** the active-chat header does not show the new-sub-chat `+` action
- **AND** it does not show the clock/history quick-switch action

#### Scenario: Use chat keyboard and menu actions

- **WHEN** a user opens chat menus or invokes registered chat shortcuts
- **THEN** no action creates, switches, splits, pins, or archives a nested chat

### Requirement: Non-Destructive Legacy Compatibility

The system SHALL preserve stored conversation data when an existing sidebar chat
contains multiple legacy internal conversation records.

#### Scenario: Open legacy multi-conversation data

- **GIVEN** a sidebar chat has multiple legacy internal conversation records
- **WHEN** the chat is opened after this change
- **THEN** one record is selected deterministically as the visible conversation
- **AND** the other records and their messages remain stored unchanged

#### Scenario: Restart with legacy data

- **GIVEN** a legacy chat has selected a canonical visible conversation
- **WHEN** the app restarts
- **THEN** the same conversation is opened when it remains valid

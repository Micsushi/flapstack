## MODIFIED Requirements

### Requirement: Scoped Search

Search SHALL support the scopes all/global, project, task, and chat, covering
projects, tasks, chats, messages, and attachments, and results SHALL carry
enough breadcrumb metadata to navigate directly to the owning sidebar chat and
matched message. The left-sidebar search SHALL remain the cross-chat search
surface; the active-chat header SHALL NOT expose a nested-chat history or search
control.

#### Scenario: Task scope isolation

- **WHEN** a user searches within a task
- **THEN** results only include that task's chats, messages, and attachments

#### Scenario: Result navigation

- **WHEN** a user activates a message search result
- **THEN** the app opens the owning sidebar chat and scrolls to the matched
  message in its visible conversation

#### Scenario: Active chat controls

- **WHEN** a user opens a sidebar chat
- **THEN** cross-chat search remains available from the left sidebar
- **AND** the active-chat clock/history control is absent

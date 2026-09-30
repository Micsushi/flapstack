## ADDED Requirements

### Requirement: Scoped Search

Search SHALL support the scopes all/global, project, task, and chat, covering
projects, tasks, chats, messages, and attachments, and results SHALL carry
enough breadcrumb metadata to navigate directly to the match.

#### Scenario: Task scope isolation

- **WHEN** a user searches within a task
- **THEN** results only include that task's chats, messages, and attachments

#### Scenario: Result navigation

- **WHEN** a user activates a message search result
- **THEN** the app opens the owning chat and scrolls to the matched message

### Requirement: Archived Items In Search

Search SHALL exclude archived items by default and SHALL include them only
when the include-archived toggle is active, with the selected scope still
applied.

#### Scenario: Default excludes archived

- **WHEN** a user searches without the include-archived toggle
- **THEN** archived chats and their messages are absent from results

#### Scenario: Toggle respects scope

- **WHEN** a user searches a project with include-archived enabled
- **THEN** archived items from that project appear, and items outside the
  project still do not

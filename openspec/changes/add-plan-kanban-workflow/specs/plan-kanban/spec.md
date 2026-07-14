## ADDED Requirements

### Requirement: Canonical task Kanban states

Flapstack SHALL represent Kanban cards as durable project tasks in fixed backlog,
planned, in-progress, review, and done states with stable order.

#### Scenario: Existing active task migrates

- **WHEN** the Stage 4 migration runs
- **THEN** active maps to in-progress without changing task identity, chats, or archive state

### Requirement: Read-only plan source view

Flapstack SHALL discover and render repo OpenSpec plus explicitly selected
Markdown plan sources with source path, fingerprint, status, and parse limitations.

#### Scenario: Plan source changes after load

- **WHEN** the current fingerprint differs from the displayed candidate
- **THEN** Flapstack marks it stale and requires refresh before promotion

### Requirement: Explicit plan-item promotion

Flapstack SHALL promote one plan candidate into exactly one real task and one
seeded task-scoped chat in one idempotent transaction and SHALL NOT launch a run.

#### Scenario: User moves a candidate to In Progress

- **WHEN** the user confirms task name, project, worktree defaults, and seed text
- **THEN** one task and one chat are created and the chat waits for user action

### Requirement: Real-task Kanban mutation

Flapstack SHALL move and order existing task cards with optimistic concurrency
and SHALL preserve task/chat identity.

#### Scenario: Two windows move the same task

- **WHEN** the second move uses a stale task version
- **THEN** Flapstack rejects it, refreshes the board, and preserves the first move

### Requirement: Approval-gated AI task proposals

Flapstack SHALL store AI-proposed work as inert proposals and require user
approval before creating task/chat state.

#### Scenario: Agent proposes many tasks

- **WHEN** proposals arrive through MCP
- **THEN** no task or chat exists until each proposal or approved bounded batch is reviewed

### Requirement: Plan-task provenance and conflict truth

Flapstack SHALL retain source fingerprint and task creation provenance without
silently syncing later plan edits into live tasks.

#### Scenario: Source requirement changes after task creation

- **WHEN** the plan candidate fingerprint changes
- **THEN** Flapstack shows divergence and offers comparison without overwriting task content

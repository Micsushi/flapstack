## ADDED Requirements

### Requirement: Project- and task-scoped saved workspaces

Flapstack SHALL save a workspace under exactly one project or task without
changing the identity of referenced chats, runs, worktrees, or files.

#### Scenario: Save current operating surface

- **WHEN** a user saves selected chats and inspection panes for a task
- **THEN** Flapstack creates one task-scoped workspace that references those
  objects and survives restart

### Requirement: Versioned restorable pane layout

Flapstack SHALL persist a versioned row/column/tab layout and restore valid panes
while exposing repair states for invalid bindings.

#### Scenario: One bound worktree is missing

- **WHEN** a workspace restores after a referenced worktree was removed
- **THEN** valid panes open and the affected pane shows a missing-worktree repair state

### Requirement: Bounded multi-chat display

Flapstack SHALL show no more than four chat panes in one window and SHALL route
overflow through tabs, pop-outs, or additional workspace windows.

#### Scenario: Workspace contains six chats

- **WHEN** a user opens a six-chat workspace in one window
- **THEN** at most four chats render concurrently and the remaining chats stay
  reachable without nested chat UI

### Requirement: Exclusive live chat ownership

Flapstack SHALL prevent two windows from actively controlling the same chat and
offer explicit focus, move, skip, or alternate-window recovery.

#### Scenario: Chat is already open elsewhere

- **WHEN** workspace restore encounters a chat claimed by another window
- **THEN** Flapstack does not duplicate control and asks the user to focus, move,
  skip, or open the remaining workspace separately

### Requirement: Crash-safe lifecycle and recovery

Flapstack SHALL save workspace changes atomically and support create, rename,
duplicate, archive, restore, and explicit delete without deleting referenced work.

#### Scenario: App exits during layout save

- **WHEN** Flapstack restarts after an interrupted layout write
- **THEN** it restores the last valid version and reports recovery instead of
  opening corrupt or empty state

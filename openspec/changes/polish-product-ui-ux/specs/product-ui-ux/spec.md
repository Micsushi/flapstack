## ADDED Requirements

### Requirement: Coherent product information architecture

Flapstack SHALL present projects, tasks, chats, runs, workspaces, Settings, and
advanced operations through one consistent navigation hierarchy.

#### Scenario: User moves from a task to its active run

- **WHEN** the user selects a task and its active chat/run
- **THEN** navigation preserves project/task context and exposes one clear return path

### Requirement: Consistent interaction states

Flapstack SHALL render loading, empty, stale, unavailable, failed, offline, and
recovery states with reusable accessible patterns and specific next actions.

#### Scenario: Workspace pane target is missing

- **WHEN** a saved pane cannot resolve its target
- **THEN** the pane shows the missing identity and bounded repair/remove actions

### Requirement: Accessible complete workflows

Flapstack SHALL support keyboard, screen-reader, zoom, contrast, reduced-motion,
and focus-safe operation for every Stage 5 primary workflow.

#### Scenario: Keyboard-only user starts an agent

- **WHEN** the user configures and confirms a new agent without a pointer
- **THEN** focus order, labels, errors, and completion feedback remain complete

### Requirement: Responsive and multi-window truth

Flapstack SHALL preserve ownership, controls, and readable hierarchy across
supported window sizes and multiple windows without duplicating active control.

#### Scenario: Same chat opens in another window

- **WHEN** a second window requests a chat controlled elsewhere
- **THEN** Flapstack shows ownership and explicit focus or move-here recovery

### Requirement: Measurable UI quality

Flapstack SHALL maintain stable visual fixtures, usability walkthroughs, and
regression evidence for core and advanced surfaces.

#### Scenario: Shared component changes

- **WHEN** a reusable component affects protected fixtures
- **THEN** review records intended visual changes or blocks accidental drift

### Requirement: Context-safe dynamic speech vocabulary

Flapstack SHALL improve speech-input recognition with a bounded, inspectable
vocabulary derived from the current project, task, chat, and user-approved terms
without exposing unrelated context or silently changing submitted text.

#### Scenario: User dictates a project-specific term

- **WHEN** dynamic vocabulary is enabled for the active scope
- **THEN** the speech engine receives only supported approved hints and the user can review the resulting transcript before submission

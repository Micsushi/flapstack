# run-permissions Specification

## Purpose

TBD - created by archiving change add-stage1-workspace-core. Update Purpose after archive.

## Requirements

### Requirement: Permission Modes

The system SHALL support the permission modes `read-only`,
`ask-before-edits`, `auto-edit-project-only`, `full-access`, and `custom`
(with stored toggles for file write, shell, network, git, browser, MCP tools,
and secrets access), and SHALL map each mode to the strongest available
native controls of the launching harness.

#### Scenario: Read-only Claude run

- **WHEN** a Claude Code run launches with mode `read-only`
- **THEN** the harness is configured so file edits are not permitted

#### Scenario: Ask-before-edits prompts

- **WHEN** an agent in `ask-before-edits` mode attempts a file edit
- **THEN** the user is prompted to approve or deny before the edit executes

#### Scenario: Unsupported control degrades visibly

- **WHEN** a custom toggle cannot be enforced by the selected harness
- **THEN** the UI marks that control as best-effort instead of silently
  ignoring it

### Requirement: Copy-On-Create Permission Inheritance

Permission defaults SHALL flow global → project → task → chat/run by copying
at creation time; later changes to a parent SHALL NOT alter existing
children, and new children SHALL copy the parent's current default.

#### Scenario: Existing child keeps its mode

- **WHEN** a project's default mode changes after a chat was created under it
- **THEN** the existing chat's mode is unchanged

#### Scenario: New child copies new default

- **WHEN** a chat is created after the project default changed
- **THEN** the new chat copies the new project default

### Requirement: Resolved Mode Visibility

The UI SHALL show the final resolved permission mode before an agent run
launches.

#### Scenario: Pre-launch display

- **WHEN** the user views the chat input bar
- **THEN** the resolved permission mode for the next run is visible

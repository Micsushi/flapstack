# cursor-harness Specification

## Purpose

TBD - created by archiving change add-stage2-voice-usage-cursor. Update Purpose after archive.

## Requirements

### Requirement: Cursor Harness Runs

The system SHALL run the `cursor-agent` CLI as a first-class coding harness via a
non-interactive stream-json child process, parsing its events into the app's
message stream and persisting run records, before/after checkpoints, and a
file-change manifest on the same basis as the Codex and Claude Code harnesses.

#### Scenario: Cursor run in a chat

- **WHEN** the user selects the Cursor harness and sends a prompt in a chat with a
  worktree
- **THEN** `cursor-agent` runs in that worktree and its streamed output renders as
  the assistant reply
- **AND** a run record with before/after checkpoints and a file-change manifest is
  persisted with harness `cursor-agent`

#### Scenario: cursor-agent not installed

- **WHEN** the `cursor-agent` binary cannot be located
- **THEN** the system reports an actionable not-installed state
- **AND** does not start a run or fabricate output

#### Scenario: Cursor API key fallback

- **WHEN** browser login is unavailable and the user stores a Cursor API key in Flapstack
- **THEN** the harness passes it to `cursor-agent` through `CURSOR_API_KEY`
- **AND** the key is not placed in process arguments, generated config, or logs

### Requirement: Cursor Harness Identity

The system SHALL identify Cursor with a teal chip and expose Cursor in the harness
and model selectors and in the per-message producer chips.

#### Scenario: Cursor identity is visible

- **WHEN** a Cursor run produces an assistant message
- **THEN** the chat tab and that message show the teal Cursor chip

### Requirement: Cursor Model Catalog

The system SHALL show Composer 2.5 and Auto in normal Cursor model selectors,
select Composer 2.5 by default for new local state, and keep all other live
Cursor CLI models behind the shared Models settings surface until the user adds
them.

#### Scenario: Small default Cursor catalog

- **WHEN** the user has not configured Cursor model visibility
- **THEN** normal chat selectors show Composer 2.5 and Auto
- **AND** Composer 2.5 is selected by default
- **AND** other models returned by `cursor-agent models` remain hidden

#### Scenario: Add a Cursor model

- **WHEN** the user enables another live Cursor model in Models settings
- **THEN** that model becomes available in normal chat selectors
- **AND** the choice persists locally

### Requirement: Cursor Permission Mapping

The system SHALL map Flapstack permission modes to the controls `cursor-agent`
actually enforces and SHALL record explicit limitations for any mode it cannot
enforce, showing the resolved mode and any degradation before launch.

#### Scenario: Unenforceable mode is degraded honestly

- **WHEN** a selected permission mode exceeds what `cursor-agent` can enforce
- **THEN** the resolved mode and a limitation warning are shown before the run
- **AND** the run records the applied permission metadata

### Requirement: Cursor Reasoning-Output Events

The system SHALL parse Cursor `stream-json` reasoning-output events when they are present
and render them through the same Reasoning output UI used for other harness reasoning
surfaces, while continuing normally when a Cursor version, model, or account tier
omits those events.

#### Scenario: Cursor emits reasoning-output deltas

- **WHEN** `cursor-agent --output-format stream-json` emits
  `type:"thinking"` delta or completed events during a run
- **THEN** those events are normalized into the shared reasoning-output message part
- **AND** the chat renders them in the Reasoning output panel before or alongside the
  assistant response

#### Scenario: Cursor omits reasoning-output deltas

- **WHEN** a Cursor run emits assistant text and tool events but no
  `type:"thinking"` events
- **THEN** the chat still renders the assistant response normally
- **AND** the system does not fabricate reasoning output

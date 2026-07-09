## ADDED Requirements

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

### Requirement: Cursor Harness Identity

The system SHALL identify Cursor with a teal chip and expose Cursor in the harness
and model selectors and in the per-message producer chips.

#### Scenario: Cursor identity is visible

- **WHEN** a Cursor run produces an assistant message
- **THEN** the chat tab and that message show the teal Cursor chip

### Requirement: Cursor Permission Mapping

The system SHALL map Flapstack permission modes to the controls `cursor-agent`
actually enforces and SHALL record explicit limitations for any mode it cannot
enforce, showing the resolved mode and any degradation before launch.

#### Scenario: Unenforceable mode is degraded honestly

- **WHEN** a selected permission mode exceeds what `cursor-agent` can enforce
- **THEN** the resolved mode and a limitation warning are shown before the run
- **AND** the run records the applied permission metadata

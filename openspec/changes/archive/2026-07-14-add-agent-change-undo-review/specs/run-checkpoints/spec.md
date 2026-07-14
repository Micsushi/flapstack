## ADDED Requirements

### Requirement: Recoverable Response Checkpoints

The system SHALL persist private before/after worktree trees for each assistant
response, including changes caused by direct edit tools and commands, without
mutating the user's branch, index, commits, or worktree.

#### Scenario: Agent response changes files

- **WHEN** an assistant response modifies one or more worktree files
- **THEN** the response has recoverable before/after trees, file paths, change
  types, unified diffs, and addition/deletion counts

#### Scenario: Recoverable tree capture is unavailable

- **WHEN** a response lacks either recoverable checkpoint tree
- **THEN** Review remains available and automatic Undo is not exposed

### Requirement: Response Changed-Files Card

The transcript SHALL group a response's file changes into one two-layer card
showing file count, total additions, total deletions, Undo, and Review on one
line when collapsed, and SHALL show a Codex-style detailed header plus
individual file rows when expanded.

#### Scenario: Multiple files changed

- **WHEN** a completed response has recoverable changes to multiple files
- **THEN** one collapsed line shows aggregate counts and expands to a detailed
  card with per-file counts rather than rendering every edit card at once

#### Scenario: User reviews a change set

- **WHEN** the user activates Review on the card or selects an expanded file row
- **THEN** Review opens the stored historical response diff at the requested
  scope even when the current worktree has moved on

### Requirement: Conflict-Safe Response Undo

The system SHALL expose one Undo action for a recoverable response change set,
SHALL preserve cleanly mergeable later changes, and SHALL never overwrite
conflicting later or manual edits.

#### Scenario: Current files still match the response output

- **WHEN** the user activates Undo and all affected files match their recorded
  after-content
- **THEN** the exact response changes are reversed atomically

#### Scenario: Later non-overlapping edits exist

- **WHEN** current content differs but every inverse change merges without
  conflict
- **THEN** Undo removes the response changes and preserves the later edits

#### Scenario: Later overlapping or unknown edits exist

- **WHEN** any inverse change conflicts or capture provenance is unsafe
- **THEN** no file is written and Review opens with the affected conflicts

#### Scenario: Undo succeeds

- **WHEN** all affected files pass preflight
- **THEN** the system creates a recovery snapshot, applies every result
  atomically, and records the change set as undone

#### Scenario: Historical run lacks recoverable content

- **WHEN** an older response has only hashes or aggregate manifest data
- **THEN** Review remains available and Undo is not shown

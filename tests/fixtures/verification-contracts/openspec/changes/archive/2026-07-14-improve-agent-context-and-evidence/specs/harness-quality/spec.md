## ADDED Requirements

### Requirement: Chat-Owned Provider Sessions

The system SHALL start a new provider session for a new Flapstack chat and
SHALL resume a provider session only when that session identifier belongs to
the same chat.

#### Scenario: New chat starts isolated session

- **WHEN** a user sends the first message in a new chat
- **THEN** the provider starts a new session
- **AND** the harness does not continue the most recent unrelated session

#### Scenario: Existing chat resumes its session

- **WHEN** a chat with a stored provider session sends another message
- **THEN** the harness resumes that exact session
- **AND** no other chat's session is selected

#### Scenario: Missing saved session recovers safely

- **WHEN** a stored session no longer exists
- **THEN** the harness clears the stale identifier and starts a new session
- **AND** it does not continue an unrelated latest session

### Requirement: Compact Session-Aware Context

The system SHALL provide provider chats with bounded project context and SHALL
avoid resending unchanged full startup files on every resumed turn.

#### Scenario: Fresh session receives selected context

- **WHEN** a provider session is created
- **THEN** it receives the applicable behavior rules and selected project files
- **AND** the context source list and fingerprint are recorded as metadata

#### Scenario: Resumed session receives compact context

- **WHEN** a provider session resumes with unchanged startup sources
- **THEN** the request receives only the compact behavior/evidence contract and
  request-relevant live context
- **AND** unchanged full file contents are not repeated

#### Scenario: Context receipt stays outside model prose

- **WHEN** context is loaded for a run
- **THEN** the UI MAY show the actual source list from metadata
- **AND** the model is not required to write a `Loaded context` receipt

### Requirement: Evidence-First Repository Claims

The system SHALL provide a fresh read-only repository scope snapshot for
requests about project status, progress, completion, remaining work, stages,
branches, or worktrees.

#### Scenario: Multiple worktrees require verification

- **WHEN** the selected repository has more than one worktree and the request
  asks for a repository-wide claim
- **THEN** the context identifies every worktree with branch and commit
- **AND** instructs the harness to inspect the applicable authoritative source
  before reporting counts or completion

#### Scenario: Live evidence outranks remembered context

- **WHEN** a handoff, startup document, or remembered fact conflicts with live
  Git or an authoritative task source
- **THEN** the answer uses the live evidence
- **AND** qualifies the stale source instead of presenting it as current truth

#### Scenario: Git preflight remains read-only

- **WHEN** repository scope is collected
- **THEN** Flapstack performs no checkout, reset, merge, commit, or file write

### Requirement: Canonical Provider Output

The system SHALL render and persist one canonical assistant answer and complete
tool evidence for every supported provider event shape.

#### Scenario: Cumulative text is not duplicated

- **WHEN** a provider emits cumulative text, a final full answer, or an exact
  repeated answer block after streamed deltas
- **THEN** the visible and persisted assistant answer contains one copy

#### Scenario: Tool evidence is preserved

- **WHEN** a provider emits a tool start or completion event
- **THEN** the stored part preserves the real tool name, identifier, input, and
  available output/result
- **AND** a known tool is not persisted only as anonymous `tool`

#### Scenario: Internal envelopes stay hidden

- **WHEN** a provider echoes Flapstack context or response-contract markers
- **THEN** the exact envelope is removed from visible reasoning and final prose
- **AND** ordinary provider-authored content remains unchanged

### Requirement: Controlled Harness Quality Gate

The system SHALL maintain a repeatable multi-provider fixture that distinguishes
the current checkout from repository-wide multi-worktree truth.

#### Scenario: Repository-wide progress fixture

- **WHEN** each supported provider is asked for repository-wide stage progress
- **THEN** it discovers the worktree topology before answering
- **AND** reports the fixture's authoritative completion count correctly

#### Scenario: Session and rendering regressions fail the gate

- **WHEN** two chats share a session unexpectedly, an answer is duplicated, an
  envelope renders, or known tool evidence is lost
- **THEN** automated verification fails

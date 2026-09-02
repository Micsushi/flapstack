## ADDED Requirements

### Requirement: Account-isolated provider authentication

Flapstack SHALL isolate every managed Codex and Claude account, keep credentials
out of renderer processes, and snapshot the selected account on every run.

#### Scenario: Account changes during an active run

- **WHEN** a user selects a different provider account while a run is active
- **THEN** the active process keeps its original account and subsequent launches
  use the new account

### Requirement: Account-correct subscription usage

Flapstack SHALL fetch and display subscription quota for the exact account and
runtime target selected for launches while preserving durable usage history.

#### Scenario: Managed account differs from system default

- **WHEN** a managed Codex account is active and `~/.codex` contains another login
- **THEN** usage and reset information are read from the managed account home and
  labeled with its opaque account identity

### Requirement: Unified cancellable Quick Open

Flapstack SHALL search supported workspace entities through one keyboard-first
surface with typed partial results, cancellation, and visible failures.

#### Scenario: File scan fails

- **WHEN** the file provider cannot read the workspace
- **THEN** Quick Open reports that provider failure while retaining valid results
  from other providers

### Requirement: Structured diff feedback

Flapstack SHALL let users attach durable comments to diff files and line ranges
and send selected comments to an agent as visible feedback.

#### Scenario: Diff changes before feedback is sent

- **WHEN** a comment's diff identity no longer matches the current diff
- **THEN** Flapstack marks it stale and requires explicit re-anchoring or removal

### Requirement: Conflict-aware repository editing

Flapstack SHALL edit supported repository files with content-identity checks,
external-change detection, explicit conflict handling, undo, and audit.

#### Scenario: File changes outside Flapstack

- **WHEN** autosave observes a different disk identity than the editor opened
- **THEN** it preserves the draft, refuses overwrite, and offers review/reload/save-as choices

### Requirement: Recoverable terminal sessions

Flapstack SHALL keep terminal PTYs and bounded display state independent of
renderer lifetime and SHALL restore or truthfully mark sessions after restart.

#### Scenario: Renderer reloads during terminal output

- **WHEN** a terminal renderer disconnects and reconnects within retention
- **THEN** it receives a consistent serialized snapshot plus subsequent output
  without duplicating or silently dropping acknowledged data

### Requirement: Bounded rich editing and diff review

Flapstack SHALL preserve Markdown semantics across structured/source editing and
SHALL load large text or image diffs without blocking the renderer or weakening
diff-comment identity.

#### Scenario: Structured editor encounters unsupported Markdown

- **WHEN** a document contains syntax the structured editor cannot represent
- **THEN** Flapstack preserves it losslessly through source mode and refuses any
  structured save that would discard it

### Requirement: Explicit terminal command profiles

Flapstack SHALL preview the exact host, shell, cwd, arguments, and referenced
environment before launching a saved terminal command or profile.

#### Scenario: Command profile contains an invalid secret reference

- **WHEN** a selected profile cannot resolve one required secret reference
- **THEN** Flapstack reports the missing reference without spawning a shell or
  exposing other resolved values

### Requirement: Reversible sparse checkout

Flapstack SHALL preview and transactionally apply worktree-scoped sparse-checkout
presets without silently discarding dirty or untracked content.

#### Scenario: Sparse preset would remove a dirty path

- **WHEN** applying a preset would hide a dirty or untracked path
- **THEN** Flapstack blocks the apply and offers review or an explicit safe
  preservation path

### Requirement: Evidence-driven workspace cleanup

Flapstack SHALL inventory cleanup candidates without mutation and SHALL
revalidate exact ownership immediately before any selected removal.

#### Scenario: Cleanup evidence becomes stale

- **WHEN** a selected resource changes owner, identity, activity, or filesystem
  state after preview
- **THEN** Flapstack skips that resource, preserves it, and reports the stale
  evidence without broadening cleanup

### Requirement: Explicit agent-aware sleep prevention

Flapstack SHALL provide Off, Automatic, and On sleep-prevention modes and SHALL
show the current assertion state and qualifying owned work.

#### Scenario: Last qualifying run settles in Automatic mode

- **WHEN** no owned run or terminal still requires background execution
- **THEN** Flapstack releases its system-sleep assertion without blocking display
  sleep or leaving an orphan helper

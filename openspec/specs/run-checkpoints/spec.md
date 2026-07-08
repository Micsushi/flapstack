# run-checkpoints Specification

## Purpose

TBD - created by archiving change add-stage1-workspace-core. Update Purpose after archive.

## Requirements

### Requirement: Before/After Run Checkpoints

The system SHALL capture a checkpoint before and after every agent run,
recording the git commit, working-tree status, and content hashes where
practical, and SHALL tolerate non-git or missing worktrees by recording an
explicit null state instead of failing the run.

#### Scenario: Checkpoint pair on completed run

- **WHEN** an agent run completes
- **THEN** the run references a before checkpoint and an after checkpoint

#### Scenario: Non-git worktree tolerated

- **WHEN** a run executes in a directory that is not a git repository
- **THEN** checkpoints record a null commit and the run proceeds normally

### Requirement: File-Change Manifests

Every run SHALL produce a file-change manifest listing changed files with
change type and addition/deletion counts, or an explicit no-change record,
and the UI SHALL show which files each run changed.

#### Scenario: Manifest after edits

- **WHEN** a run modifies files
- **THEN** the manifest lists each changed file with its change type and
  line counts

#### Scenario: Explicit no-change record

- **WHEN** a run completes without file changes
- **THEN** the run has an explicit no-change record rather than an absent
  manifest

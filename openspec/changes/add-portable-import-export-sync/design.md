## Context

`import-export.ts` exposes disabled scope planning because format and migration
policy were unresolved. Chat export exists but is not a product backup. Stage 4
adds knowledge, extensions, workspaces, and advanced usage that need selective
portable state.

## Goals / Non-Goals

- Goals: readable versioned backup, selective export, safe dry-run import,
  migrations, conflict recovery, integrity, and optional user-owned git sync.
- Non-goals: hosted Flapstack accounts/sync, automatic credential transfer,
  live multi-writer database replication, or syncing run processes/worktrees.

## Decisions

- Bundle is a directory ending `.flapstack-export/`: `manifest.json`, SQLite
  backup, file-backed scope folders, checksums, and exclusion report. Avoid a new
  archive dependency; packaging can be added later without changing contents.
- Scope registry owns stable IDs, dependencies, sensitivity, export/import
  handlers, and schema versions. Full export composes registered scopes.
- Export takes a consistent SQLite backup and copies file-backed content through
  registered handlers. It never copies live WAL/SHM files.
- Secrets are excluded. The report names secret categories, never values. An
  encrypted secret-export mode is not included.
- Import always parses, verifies checksums, migrates into staging, and shows a
  typed create/update/conflict/skip/delete-free diff before apply.
- Apply creates a pre-import backup, uses transactional database replacement and
  staged atomic file swaps, then restarts affected services. Failure rolls back.
- Private sync supports only safe file-backed scopes through a user-selected git
  remote/repo. Database history is export/import, not live git merge.
- Sync never commits/pushes automatically without explicit user action or a
  separately approved automation.

## Risks / Trade-offs

- Cross-version import can corrupt state. Staging migration and full rollback are
  mandatory; unsupported future versions fail before apply.
- File/database scope conflicts can cross-reference. The scope registry declares
  dependencies and import ordering.
- Git sync can expose private data. Exact included paths and exclusion report are
  shown before initialization, commit, pull, or push.

## Migration Plan

No existing state changes until the first export/import. Import creates a backup
and records an operation journal for restart recovery.

## Open Questions

- None blocking. Versioned directory bundle and secrets-excluded default are fixed.

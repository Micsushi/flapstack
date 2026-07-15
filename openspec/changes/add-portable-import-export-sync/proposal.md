# Change: Add portable import, export, and private sync

## Why

Flapstack stores durable local state but cannot back it up, move selected state
between machines, preview an import, or synchronize user-owned configuration.

## What Changes

- Add a versioned directory bundle with manifest, SQLite snapshot, content files,
  checksums, scope metadata, and exclusion report.
- Add selective export for settings, extensions, knowledge, workspaces, usage,
  project metadata, and optional history.
- Add dry-run import diff, schema migration, conflict policy, transactional apply,
  rollback, and restart recovery.
- Add optional user-owned private git sync for file-backed safe scopes only.
- Exclude secrets by default; no hosted Flapstack sync.

## Impact

- Affected specs: new `data-portability-sync` capability.
- Affected code: import/export router, database backup/migrations, settings,
  extensions, vaults, workspaces, usage export, git service, renderer, and tests.

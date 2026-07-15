# Change: Add saved workspaces

## Why

Flapstack has chats, terminals, diffs, files, worktrees, and multiple windows,
but users cannot save those surfaces as one restorable project/task workspace.

## What Changes

- Add project- and task-scoped saved workspace records with versioned pane layouts
  and optional manual or orchestration ownership.
- Support chat, terminal, diff, file/editor, and browser panes with explicit
  missing/stale states.
- Show at most four chat panes in one window; overflow uses tabs, pop-outs, or
  another workspace window.
- Reuse current window chat ownership so one chat cannot be controlled twice.
- Add create, rename, duplicate, archive, restore, delete, crash-safe save, and
  restart recovery.
- Auto-create one task-scoped operation workspace for an orchestration and keep
  its roster synchronized with the initiating and descendant agent chats.

## Impact

- Affected specs: new `saved-workspaces` capability.
- Affected code: SQLite schema/migrations, workspace router/service, Agents shell,
  terminal/diff/file/browser surfaces, window manager, local state migration.

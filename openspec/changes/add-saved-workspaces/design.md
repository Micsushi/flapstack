## Context

The current UI often calls one chat a workspace, but the product model now
reserves workspace for a saved multi-surface layout. Existing chat IDs and rows
remain conversations and are referenced, never migrated into workspace rows.

## Goals / Non-Goals

- Goals: simple saved layouts, project/task scope, restart restore, stale-state
  honesty, and safe multi-window ownership.
- Non-goals: replacing tasks/chats, restoring hidden nested chat UI, remote sync,
  arbitrary web automation, or a general window manager framework.

## Decisions

- Store workspace metadata and a versioned JSON pane tree in SQLite. Pane
  bindings reference existing objects; they do not duplicate chat/run data.
- Start with row/column splits, tabs, and one active item per pane group. Avoid a
  freeform canvas.
- Limit visible chat panes to four per window. Additional chats become tabs or
  open in another window.
- Reuse `windowManager` chat claims. Restore offers focus existing, move here,
  skip pane, or open another workspace; it never creates two live owners.
- Persist terminal binding metadata, not running PTY processes. Restart creates a
  fresh terminal only after explicit restore policy allows it.
- Invalid panes do not block the workspace; they render a repair/remove state.

## Risks / Trade-offs

- Existing code uses `workspace` to mean chat. New types and UI copy must avoid
  risky broad renames; introduce `SavedWorkspace` explicitly.
- Browser/editor panes can balloon scope. Reuse current file/diff/web-link
  surfaces first; no new IDE or browser engine.

## Migration Plan

Add tables and routes without changing current chat navigation. A one-time
optional action can save currently open chats as a workspace. Rollback leaves
all referenced chats, tasks, terminals history, and files intact.

## Open Questions

- None blocking. Default new workspace layout is one chat pane plus existing
  details; terminal/diff panes are added explicitly.

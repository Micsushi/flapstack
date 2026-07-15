## Context

The current UI often calls one chat a workspace, but the product model now
reserves workspace for a saved multi-surface layout. Existing chat IDs and rows
remain conversations and are referenced, never migrated into workspace rows.

## Goals / Non-Goals

- Goals: simple saved layouts, project/task scope, restart restore, stale-state
  honesty, safe multi-window ownership, and one durable operation workspace for
  every multi-agent orchestration.
- Non-goals: replacing tasks/chats, restoring hidden nested chat UI, remote sync,
  arbitrary web automation, or a general window manager framework.

## Decisions

- Store workspace metadata and a versioned JSON pane tree in SQLite. Pane
  bindings reference existing objects; they do not duplicate chat/run data.
- A workspace has `ownerKind` `manual` or `orchestration`. An orchestration-owned
  workspace is task-scoped and has one stable `orchestrationId`; the association
  is unique in both directions.
- Start with row/column splits, tabs, and one active item per pane group. Avoid a
  freeform canvas.
- Limit visible chat panes to four per window. Additional chats become tabs or
  open in another window.
- Reuse `windowManager` chat claims. Restore offers focus existing, move here,
  skip pane, or open another workspace; it never creates two live owners.
- Persist terminal binding metadata, not running PTY processes. Restart creates a
  fresh terminal only after explicit restore policy allows it.
- Invalid panes do not block the workspace; they render a repair/remove state.
- Starting an orchestration records its workspace link in the same durable launch
  transaction or a recoverable intent record. If one side materializes first,
  restart reconciliation repairs the missing link without starting worker work.
- The operation roster is derived from the initiating chat and durable
  `orchestration_agents.chat_id` links. A newly materialized agent joins the roster
  automatically. Roster membership does not force every chat to render.
- The default operation layout is lead chat, agent/phase navigator, selected-agent
  detail, and activity/artifact inspection. At most four chat panes render; a
  large team uses the roster, tabs, and pop-outs rather than a wall of chats.
- Archiving or deleting an operation workspace never stops or deletes its
  orchestration, chats, runs, or worktrees. Active operation workspaces require an
  impact preview and can be regenerated from durable orchestration lineage.

## Risks / Trade-offs

- Existing code uses `workspace` to mean chat. New types and UI copy must avoid
  risky broad renames; introduce `SavedWorkspace` explicitly.
- Browser/editor panes can balloon scope. Reuse current file/diff/web-link
  surfaces first; no new IDE or browser engine.
- Dynamic agent rosters can churn layout. Keep roster membership separate from
  the user's pane tree and change the selected-agent binding instead of adding a
  split for every spawn.

## Migration Plan

Add tables and routes without changing current chat navigation. A one-time
optional action can save currently open chats as a workspace. Rollback leaves
all referenced chats, tasks, orchestrations, terminal history, and files intact.

## Open Questions

- None blocking. Manual workspaces default to one chat pane plus existing details.
  Operation workspaces use the lead/navigator/selected-agent/activity layout and
  bind terminal/diff panes explicitly.

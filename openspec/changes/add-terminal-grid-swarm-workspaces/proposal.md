# Change: Add multi-pane chat and swarm workspaces

## Why

Flapstack has top-level Chat tabs, window ownership, saved row/column layouts,
and pane pop-out buttons, but these pieces do not yet provide a VS Code-style
interactive Chat workbench. Current saved-workspace Chat panes are transcript
readers, top-level Chat tabs only reorder, and dragging a tab outside the window
does not create a floating Flapstack window.

Power users need up to four fully interactive Chats in one window and a dense
supervision view for existing agents and terminals. This must reuse durable Chat
identity and existing authority rather than create hidden agents, duplicate
Chats, a second scheduler, or another task model.

## What Changes

- Add a VS Code-style Chat group tree with draggable tabs, directional drop
  zones, resizable splits, layout presets, and at most four visible interactive
  Chat groups per window.
- Give every visible Chat pane its own header, transcript scrollbar, composer,
  run state, errors, and focus while shared app chrome follows the active pane.
- Move a dragged Chat into a floating Flapstack window when it is dropped
  outside every valid group; allow the same tab to move back or into another
  Flapstack window without creating a new Chat.
- Enforce one app-wide budget of four visible Flapstack workbench windows total,
  including the main window; dialogs, native pickers, and hidden utility windows
  do not consume the budget.
- Add saved terminal/chat/agent grid layouts over existing workspaces and reuse
  the same group compositor for tabs, splits, pop-outs, and restoration.
- Add fleet, lineage, activity, and task-path projections beside panes.
- Add bounded selection and group controls through existing authority.
- Add layout/session persistence, crash-safe ownership transfer, responsive
  collapse, keyboard parity, accessibility, scale, and recovery behavior.

## Impact

- Affected specs: terminal-swarm-workspaces capability.
- Affected code: top-level Chat tabs, ActiveChat extraction, saved workspaces,
  pane adapters, terminals, orchestration fleet, lineage, Electron window/drag
  ownership, group controls, layout persistence, and tests.

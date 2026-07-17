## ADDED Requirements

### Requirement: Fully interactive multi-Chat groups

Flapstack SHALL render one to four visible top-level Chat groups in a window,
with each visible Chat owning an independent header, transcript scrollbar,
composer, draft, run controls, streaming state, failure state, and focus target.

#### Scenario: Four Chats run concurrently

- **WHEN** the user sends prompts from four visible Chat panes
- **THEN** every Chat streams, scrolls, accepts input, and reports errors
  independently without changing any other Chat's identity, draft, or focus

### Requirement: VS Code-style bounded group layout

Flapstack SHALL arrange Chat groups through a versioned row/column tree with
resizable sashes, tabs, maximize/restore, keyboard navigation, directional
splits, and predefined one-, two-, three-, and four-pane layouts.

#### Scenario: User selects a mixed three-pane layout

- **WHEN** the user selects Two Rows Right or creates its mirrored form by drag
- **THEN** one Chat group occupies one side, two groups occupy the other side,
  and all three remain independently resizable and operable

#### Scenario: User attempts a fifth visible Chat group

- **WHEN** four Chat groups are already visible in the window
- **THEN** Flapstack refuses a fifth split and offers to tab the Chat into a
  group or move/open it in another window

### Requirement: Directional Chat-tab drag and drop

Flapstack SHALL preview and apply tab reorder, center-to-tab, and
left/right/top/bottom split targets through drag and drop without losing the
source state on cancellation or invalid targets.

#### Scenario: User drags a Chat to a pane edge

- **WHEN** the pointer enters a valid edge target and the user drops
- **THEN** Flapstack shows the previewed split, moves that same Chat into it,
  and preserves the Chat's draft, transcript anchor, and active run

### Requirement: Floating Flapstack windows

Flapstack SHALL move a dragged Chat into a new floating Flapstack window when
the drop ends outside every valid Flapstack group and SHALL allow floating
windows to host the same one-to-four group layout.

#### Scenario: User drops a tab outside the current window

- **WHEN** the drag ends outside all registered Flapstack windows
- **THEN** a floating window opens with that same Chat, the source tab is
  removed only after destination readiness, and no new Chat row is created

#### Scenario: Cross-window transfer fails

- **WHEN** the destination closes, rejects ownership, or crashes before commit
- **THEN** the source presentation and editable ownership remain or recover
  without exposing two editable controllers

### Requirement: Four-window application budget

Flapstack SHALL allow at most four visible workbench windows across the running
application, including the main window, and SHALL enforce this limit through one
race-safe main-process authority for every window creation path.

#### Scenario: User opens the fourth workbench window

- **WHEN** the main window and two auxiliary workbench windows exist
- **THEN** one additional Chat or Saved Workspace window may open and the app
  reports that all four workbench-window slots are occupied

#### Scenario: User drags out a Chat at the window limit

- **WHEN** four counted workbench windows are live or reserved
- **THEN** Flapstack leaves the source Chat and ownership unchanged and offers
  existing-window tab/group destinations, focus, or cancel

#### Scenario: Non-workbench dialog opens at the limit

- **WHEN** four workbench windows are live and a confirmation dialog, native
  picker, capture overlay, or hidden utility window is required
- **THEN** that non-workbench surface opens without consuming another slot

#### Scenario: Legacy session contains more than four windows

- **WHEN** Flapstack restores a session whose saved state names more than four
  workbench windows
- **THEN** it restores main plus the three most-recently-focused valid windows
  and keeps every remaining layout dormant and recoverable until a slot opens

### Requirement: Accessible non-drag layout control

Flapstack SHALL expose every split, focus, move, resize, maximize, join, and
new-window operation through commands/context menus and accessible keyboard
semantics in addition to pointer drag.

#### Scenario: Keyboard user moves a Chat into a new window

- **WHEN** the user invokes Move into New Window without dragging
- **THEN** the same atomic transfer and restoration rules apply and focus lands
  in the moved Chat's last meaningful control

### Requirement: Restorable window and responsive layout

Flapstack SHALL crash-safely restore stable windows, bounds, group trees, active
tabs, and compatible Saved Workspace layouts while preserving a too-small
logical layout through reversible responsive collapse.

#### Scenario: Four-column window reopens on a smaller display

- **WHEN** the saved pane minimums no longer fit the available bounds
- **THEN** Flapstack clamps the window to the display, temporarily converts the
  excess visible groups to labeled tabs, and restores them when space returns

### Requirement: Existing-object grid composition

Flapstack SHALL compose grid panes from existing chats, terminals, runs, agents,
worktrees, and inspection surfaces without creating duplicate work identities.

#### Scenario: User adds an agent chat to a grid

- **WHEN** that chat is controlled in another window
- **THEN** the new pane is read-only until ownership is explicitly moved

### Requirement: Durable bounded grid layouts

Flapstack SHALL save, restore, resize, tab, and repair grid layouts with bounded
resource use and independent stale-pane handling.

#### Scenario: One worktree is missing after restart

- **WHEN** the grid restores
- **THEN** other panes open and the missing pane offers explicit repair/removal

### Requirement: Truthful fleet and lineage projection

Flapstack SHALL show exact orchestration, agent, runtime, task-path, lineage,
activity, budget, and terminal state from authoritative services.

#### Scenario: Agent becomes uncertain after restart

- **WHEN** durable runtime reconciliation cannot prove terminal state
- **THEN** the grid shows uncertain and offers no false resume/replay

### Requirement: Bounded group control

Flapstack SHALL apply group pause/resume/cancel/steer only to an exact reviewed
selection through existing permissions, approval, audit, and cascade services.

#### Scenario: Group cancel partially fails

- **WHEN** some selected agents cannot cancel
- **THEN** each result remains visible and successful siblings are not rolled back

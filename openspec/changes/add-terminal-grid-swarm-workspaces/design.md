## Context

BridgeMind/BridgeSpace are interaction references only. Stage 4 already owns
agents, chats, runs, worktrees, workspaces, orchestration, and cancellation.

The current code contains three partial foundations that must not be mistaken
for the requested feature:

- `AgentsContent` renders top-level Chat tabs and supports pointer-based reorder,
  but it has one selected `ChatView` and no split/drop/floating-window behavior.
- The legacy internal `sub_chat` split renders full controls, but it is
  column-only, belongs to the removed nested-conversation model, and cannot be
  the product architecture for top-level Chats.
- Saved Workspaces support row/column/tab layout, four visible Chat panes, and a
  pop-out button, but `WorkspaceChatPane` is a transcript-only reader.

VS Code is the behavioral reference, not a code dependency. Its editor model
uses tab groups in a recursive grid, edge drops to create groups, center drops
to tab into a group, resizable sashes, predefined layouts, and floating windows
created by dragging a tab outside the current window. VS Code does not impose a
four-group limit. Flapstack deliberately keeps a four-visible-Chat limit because
each Chat includes streaming state and a composer; extra Chats remain tabs or
move to another window.

Reference behavior: [VS Code User Interface](https://code.visualstudio.com/docs/editing/userinterface)
and [VS Code Custom Layout](https://code.visualstudio.com/docs/configure/custom-layout).

## Goals / Non-Goals

- Goals: one-to-four fully interactive Chat panes, VS Code-style tab placement,
  floating windows, dense visibility, fast navigation, bounded group control,
  saved layouts, honest status, keyboard access, and large-fleet performance.
- Non-goals: hidden swarm creation, unlimited concurrency, second scheduler,
  raw terminal multiplexing protocol, nested Chats, duplicating a Chat when a
  tab moves, or four copies of global navigation/details chrome.

## Decisions

### One compositor, two entry levels

- The normal Chat workbench uses the compositor directly. Users can split from
  the tab, context menu, command, or a directional drag target without first
  creating a Saved Workspace.
- Advanced Saved Workspaces add terminal, run, agent, diff, file, browser, and
  fleet panes over the same compositor. They do not maintain a second layout
  engine.
- A grid pane binds an existing durable Chat or inspection identity. Moving a
  tab changes presentation/ownership only; it never inserts a `chats` row.

### Group and layout model

- Persist a versioned recursive tree: split nodes have `row` or `column`
  direction and sizes; leaf groups have ordered tabs and one active tab.
- A normal Flapstack window shows at most four interactive Chat groups. Any
  number of open Chats may remain reachable as tabs, subject to existing product
  resource limits. Advanced non-Chat panes keep their separately declared
  virtualization limits.
- Include Single, Two Columns, Two Rows, Three Columns, Three Rows, Grid 2x2,
  Two Rows Right, and Two Columns Bottom presets. Four Columns and Four Rows are
  supported when the window meets minimum pane dimensions. Directional drag can
  create the mirrored asymmetric forms.
- A fourth split is allowed only when its resulting panes meet the responsive
  minimum. A fifth visible Chat group is rejected with a visible choice to tab
  it into the target group or open/move it to another window.
- Closing the last tab removes that group and normalizes the tree. Closing a
  tab never archives or deletes its Chat.

### Full Chat pane boundary

- Extract the canonical interactive Chat surface from the route shell. Every
  pane owns its Chat header, transcript and vertical scrollbar, timeline,
  composer/input draft, provider/model/run controls, streaming/error state, and
  focus target.
- Global/project navigation remains one shared window sidebar. The shared right
  details surface follows the active pane; pane-local actions stay in the pane
  header/composer. This avoids unusable repeated sidebars while keeping every
  Chat independently operable.
- Simultaneous streaming and sending in different panes are supported. Moving a
  tab preserves unsent drafts, IME composition safety, transcript anchor, run
  state, and pending approvals.

### Drag and drop

- Dragging within a tab strip reorders tabs. Dropping in another group's center
  moves the tab into that group. Dropping on left/right/top/bottom edge targets
  creates or joins a split at that position.
- Drop overlays show the exact result before release. Escape cancels. Invalid,
  stale, capacity-exceeding, or too-small targets fail visibly and leave the
  source unchanged.
- Replace the current renderer-only pointer reorder with a versioned drag
  session coordinated by the Electron main process. The session carries an
  opaque nonce, Chat ID, source stable-window/group IDs, operation (`move` or
  read-only `copy`), and expiration; it never carries transcript or credentials.
- Dropping outside every registered Flapstack window moves the same Chat into a
  new floating window. Dropping on another Flapstack window moves it into that
  window's chosen group/edge. `Move into New Window` and keyboard commands are
  required fallbacks for platforms or assistive input where drag is unavailable.

### Floating windows and ownership

- A floating window starts with one group but can itself host the same one-to-four
  group layout. It uses normal Flapstack providers and project context, not a
  stripped transcript viewer.
- Flapstack permits at most four visible workbench windows across the app. The
  main window counts, leaving at most three simultaneous auxiliary Chat or Saved
  Workspace windows. Modal confirmation/settings dialogs, OS file/folder
  pickers, capture overlays, and hidden background/utility windows do not count.
- Every creation path uses one main-process `WindowBudget` authority before
  constructing a `BrowserWindow`: tab drag-out, Move/Copy into New Window, New
  Window, Saved Workspace pop-out, open remainder, restored sessions, and
  automation/API-triggered window requests. Renderer checks are previews only.
- At the four-window cap, no source tab or ownership claim changes. Flapstack
  shows the four existing destinations with active project/Chat summaries and
  offers Move to Window, Add as Tab, Focus Window, or Cancel. Closing a counted
  window frees one slot only after main-process destruction cleanup completes.
- If an upgrade/session contains more than four saved workbench windows,
  Flapstack restores the main window plus the three most recently focused valid
  windows. Remaining window layouts stay dormant and explicitly restorable
  after a slot opens; their Chats and drafts are not discarded.
- Editable ownership transfers atomically from source window to destination
  window after the destination is ready. Failure keeps or restores the source
  claim; two editable owners are never exposed.
- Default drag is move. A context-menu `Copy into New Window` action creates a
  read-only mirror because one Chat cannot have two live controllers. Moving the
  mirror's ownership requires the existing explicit focus/move flow.
- Stable window ID, display, bounds, group tree, active group/tab, and compact
  state restore after restart. Missing displays are clamped to an available
  display. Closing a window closes presentation only and preserves every Chat.

### Core contracts and ownership

The implementation should introduce small shared contracts instead of passing
renderer component state through IPC:

```ts
const MAX_WORKBENCH_WINDOWS = 4
const MAX_VISIBLE_CHAT_GROUPS_PER_WINDOW = 4

type WorkbenchWindowKind = "main" | "chat" | "saved-workspace"
type ChatDropZone = "tab" | "left" | "right" | "top" | "bottom" | "outside"

type ChatWorkbenchLayout = {
  version: 1
  root: ChatGroupNode
  activeGroupId: string
}

type ChatGroupNode =
  | { type: "group"; id: string; chatIds: string[]; activeChatId: string }
  | {
      type: "split"
      id: string
      direction: "row" | "column"
      sizes: number[]
      children: ChatGroupNode[]
    }

type ChatWindowTransfer = {
  nonce: string
  chatId: string
  sourceWindowId: string
  sourceGroupId: string
  operation: "move" | "read-only-copy"
  expiresAt: number
}
```

- Shared types/schemas own validation and migration. Renderer reducers own
  layout preview and normalization. Electron main owns window budget, screen
  routing, stable IDs, and editable Chat ownership. SQLite/Saved Workspace
  services own promoted durable layouts. Chat runtime stores remain keyed by
  durable Chat ID and never become group/window-owned data.
- A move follows `preview -> reserve destination/slot -> destination ready ->
compare-and-transfer Chat claim -> commit destination layout -> remove source
presentation`. Any failure before commit rolls back the reservation and keeps
  the source. A read-only copy never transfers the editable claim.
- Window-budget reservations have opaque IDs and short expiry. They prevent two
  simultaneous drag-outs from both observing the fourth slot as free.

### Source-to-target component map

| Current area                         | Current limitation                                 | Stage 5 ownership                                               |
| ------------------------------------ | -------------------------------------------------- | --------------------------------------------------------------- |
| `AgentsContent` top-level tabs       | Reorder only; one selected `ChatView`              | Thin route shell around `ChatWorkbench`                         |
| `ActiveChat` / `ChatViewInner`       | Large route-coupled interactive Chat               | Extract reusable `InteractiveChatPane` keyed by Chat ID         |
| Legacy `SplitViewContainer`          | Column-only internal `sub_chat` state              | Retire from product path after migration; do not extend         |
| Saved Workspace layout reducer/shell | Useful tree/sashes/tabs, separate UI               | Generalize into shared group compositor                         |
| `WorkspaceChatPane`                  | Transcript-only reader                             | Use read-only or interactive shared Chat pane by ownership      |
| `WindowManager`                      | Tracks windows and Chat claims; no creation budget | Own four-window budget, reservation, transfer, restore ordering |
| `main.ts` window IPC                 | Each handler may create a window directly          | Route every counted creation through one budget service         |
| Window-scoped local storage          | Open tabs but no durable group/window session      | Versioned session store with migration and dormant overflow     |

### Commands and visible behavior

| User action                        | Available result                                             |
| ---------------------------------- | ------------------------------------------------------------ |
| Drag within tab strip              | Reorder in the same group                                    |
| Drop in group center               | Move Chat as a tab in that group                             |
| Drop on group edge                 | Create left/right/top/bottom split if group/pane cap permits |
| Drop on another Flapstack window   | Move into that window's selected center/edge target          |
| Drop outside all Flapstack windows | Create a counted floating window if a slot exists            |
| Move into New Window               | Same move transaction without pointer drag                   |
| Copy into New Window               | Read-only copy; no second editable owner                     |
| Split Left/Right/Up/Down           | Keyboard/context-menu equivalent of edge drop                |
| Window limit reached               | Keep source unchanged; choose existing window/tab or cancel  |
| Close group/window                 | Close presentation only; never archive/delete Chat           |

### Persistence and responsive behavior

- Window-session layouts auto-save crash-safely. `Save as Workspace` promotes
  the current layout into the existing Saved Workspace lifecycle without
  duplicating identity or maintaining a parallel schema.
- Existing `openChatIds` migrate into one leaf group. Existing Saved Workspace
  layouts continue to open unchanged through a versioned adapter.
- When a window becomes too small, preserve the logical tree but temporarily
  collapse the least-recently-focused groups into tabs with an explicit
  responsive-state notice. Restore those groups when space returns.

### Swarm extension and resource control

- Grid group actions call F3/F11 shared controls with exact selection, preview,
  approval, budgets, and partial results.
- Fleet/lineage projections never duplicate provider activity or private reasoning.
- Inactive tabs suspend expensive rendering/subscriptions without stopping
  their runs. Visible panes use bounded rendering and terminal backpressure.
- Keyboard commands cover focus group, move tab, split left/right/up/down,
  resize, maximize/restore, move to window, and join/close group. Pointer,
  keyboard, screen-reader, reduced-motion, and touch paths expose the same state.

## Migration Plan

1. Add the versioned group-tree/session model and adapt existing `openChatIds`
   into one group without changing Chat rows.
2. Extract the full Chat pane and replace only the normal workbench renderer.
3. Enable in-window groups, presets, and the four-visible-group cap.
4. Add the main-process four-window budget and make every window creation path
   consume it before enabling cross-window drag/ownership.
5. Route Saved Workspaces through the same compositor and migrate only their
   layout version when saved.
6. Add advanced fleet/group surfaces after normal Chat behavior is accepted.

Rollback reads the last compatible single-group/open-tab state. Existing
workspaces open unchanged. Invalid panes and failed window transfers degrade
independently without changing underlying Chats or runs.

## Risks / Trade-offs

- Cross-window HTML drag behavior differs by OS. T1 must prove drag end,
  coordinates, cancellation, and drop handoff on macOS, Windows, and Linux;
  context-menu and keyboard move remain first-class fallbacks.
- Extracting `ActiveChat` can duplicate subscriptions or break composer focus.
  Keep Chat runtime state keyed by Chat ID outside pane component lifetime and
  add simultaneous-stream/draft/focus regression tests before enabling splits.
- Four narrow full composers can become unusable. Enforce measured minimum pane
  dimensions and responsive collapse instead of squeezing controls or silently
  deleting the saved layout.
- Window transfer can race with close/crash. Use destination-ready plus
  compare-and-transfer ownership, then source release, with restart reconciliation.
- Window creation can race at the fourth slot. Reserve in the main process before
  construction and expire abandoned reservations; never rely on renderer counts.

## Open Questions

None blocking. The confirmed defaults are four visible interactive Chat groups
per window, four counted Flapstack workbench windows total including main,
shared window navigation/details chrome, move-on-drag, read-only copy, and the
same layout capability inside floating windows.

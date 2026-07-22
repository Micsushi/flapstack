# Stage 6 Multi-Pane Chat and Window Test Plan

This document is the manual acceptance walkthrough for S6-F6. Task status
remains authoritative in
`openspec/changes/add-terminal-grid-swarm-workspaces/tasks.md`; integrated
acceptance remains authoritative in `docs/stage6-full-feature-test-matrix.md`.

## Product Limits

- Maximum visible interactive Chat groups per workbench window: 4.
- Maximum visible workbench windows per running app: 4 total.
- The main window consumes one slot; at most three auxiliary Chat or Saved
  Workspace windows may exist.
- Dialogs, native file/folder pickers, capture overlays, and hidden utility
  windows do not consume workbench-window slots.
- Moving a Chat changes presentation and editable ownership only. It never
  creates, archives, duplicates, or deletes the durable Chat.

## Required Evidence Header

Record this before each native-platform run:

```text
SHA:
Checkout:
Branch:
Build/profile: Flapstack Dev | macOS preview | Windows package | Linux package
OS/version/architecture:
Display count and bounds:
Node/npm/Electron versions:
Database/profile path:
Provider/runtime fixtures or credentials class:
Started/restarted after final change at:
Tester:
```

Headless evidence cannot close pointer drag, screen routing, native window,
screen-reader, package, or multi-display rows.

## Automated Preflight

Run from the exact candidate checkout:

```bash
npm run check
OPENSPEC_TELEMETRY=0 npx --yes @fission-ai/openspec@latest validate add-terminal-grid-swarm-workspaces --strict --no-interactive
npm run dev
npm run dev:verify
```

Expected:

- Node 22 repository gate passes.
- Strict S6-F6 OpenSpec validation passes.
- `dev:verify` identifies the exact checkout and `Flapstack Dev` profile.
- No older packaged Flapstack process is mistaken for Dev.

## Test Data

Prepare one project with:

- At least six durable top-level Chats with distinct names.
- Four Chats capable of concurrent fixture or live streaming.
- One Chat with a non-empty unsent multiline draft and IME composition fixture.
- One long Chat with enough transcript content to require vertical scrolling.
- One active approval and one deterministic failed run fixture.
- One Saved Workspace containing Chat, terminal, diff, file, and browser panes.
- One stale worktree/file binding and one orchestration fleet of at least five
  agents; use 100-agent projection fixtures for scale evidence.

Capture the Chat IDs before testing. Query them again after all moves to prove
that no move/copy operation inserted or deleted a Chat.

## A. Group Layout and Full Chat Independence — S6-TG01/TG02

### A1 — Two and three groups

1. Open Chat A in the main window.
2. Split right and place Chat B.
3. Split Chat B down and place Chat C.
4. Resize both sashes by pointer and keyboard.
5. Focus each group through pointer and group-focus commands.

Pass:

- Layout is one left group plus two right groups.
- Every group has its own heading, transcript scrollbar, composer, draft,
  provider/model/run controls, errors, and focus indicator.
- Shared navigation appears once. Shared details follow the active group.
- Resizing never moves focus into another composer or resets scroll position.

### A2 — Preset and mirrored layouts

Apply and verify:

- Single.
- Two Columns and Two Rows.
- Three Columns and Three Rows.
- Grid 2x2.
- Two Rows Right and its directional-drag mirror.
- Two Columns Bottom and its directional-drag mirror.
- Four Columns and Four Rows on a display large enough for pane minimums.

Pass:

- Preview matches the committed tree and sash orientation.
- All groups remain keyboard reachable and independently resizable.
- Closing the last tab in one group normalizes the tree without archiving Chat.

### A3 — Four simultaneous Chats

1. Open four visible Chat groups.
2. Enter a distinct draft in each.
3. Send or start all four runs.
4. Scroll each transcript to a different anchor while streams continue.
5. Cause one deterministic failure and leave one approval pending.

Pass:

- All four send/stream independently.
- Draft, IME, focus, scroll anchor, approval, error, and run state never cross
  Chat boundaries.
- Typing remains within the declared Stage 6 input-latency budget.

### A4 — Fifth group

Attempt a fifth directional split by drag and by command.

Pass:

- No fifth visible group appears.
- Source Chat and draft remain unchanged.
- UI offers Add as Tab or Move/Open in an existing/new allowed window.

## B. Drag and Command Parity — S6-TG02/TG03

For Chat A, verify:

1. Reorder within one tab strip.
2. Drop into another group's center.
3. Drop on left, right, top, and bottom targets.
4. Cancel each operation with Escape.
5. Repeat with Split/Move commands and context-menu actions.

Pass:

- Drop overlay names and previews the exact result.
- Cancel, stale target, too-small target, and cap rejection leave source state
  unchanged.
- Keyboard/context-menu result matches pointer result and restores focus to the
  moved Chat's last meaningful control.

## C. Four-Window Budget — S6-TG04

### C1 — Reach the limit

1. Start with main only: expected count 1.
2. Open Chat B in auxiliary window 2.
3. Pop a Saved Workspace pane into window 3.
4. Move Chat C into new window 4.

Pass:

- Exactly four counted workbench windows exist: main plus three auxiliary.
- UI reports no remaining workbench-window slot.
- Stable IDs are unique and Chat ownership is singular.

### C2 — Reject every fifth-window path

At four windows, try concurrently where practical:

- Drag a Chat outside all windows.
- Move into New Window.
- Copy into New Window.
- Sidebar New Window.
- Saved Workspace pane pop-out.
- Saved Workspace remainder window.
- Session/API/automation-triggered window request.

Pass:

- No fifth counted `BrowserWindow` is constructed, including under concurrent
  requests.
- Every caller receives the typed at-limit result.
- Source layouts, tabs, claims, drafts, and runs stay unchanged.
- Destination chooser lists the existing four windows without transcript,
  credential, or private-reasoning content.

### C3 — Exempt surfaces

At four workbench windows, open a confirmation dialog, native folder picker,
capture overlay, and required hidden utility surface.

Pass:

- Each exempt surface still works.
- Counted workbench-window total remains four.

### C4 — Release and reuse slot

1. Close auxiliary window 3.
2. Before its destruction cleanup completes, race one new-window request.
3. After cleanup completes, retry.

Pass:

- No early/double slot release occurs.
- Exactly one later creation succeeds.
- Abandoned reservations expire and do not leak capacity.

## D. Cross-Window Ownership and Recovery — S6-TG03

### D1 — Move between existing windows

Drag Chat A from main to a center and edge target in window 2, then pull it back.

Pass:

- Same Chat ID appears at destination.
- Destination becomes editable only after atomic claim transfer.
- Source tab disappears only after destination readiness.
- Draft, active run, approval, and scroll state survive.

### D2 — Drag outside to floating window

With a free window slot, drop Chat B outside all registered Flapstack windows.

Pass:

- One floating workbench window opens.
- It has normal interactive Chat UI and can host up to four groups.
- No new Chat row or run is created.

### D3 — Read-only copy

Use Copy into New Window.

Pass:

- Copy is visibly read-only.
- Sending, permission mutation, archive, and destructive controls are disabled.
- Explicit Move Here transfers ownership through the normal confirmation path.

### D4 — Failure injection

Inject failure at destination reservation, construction, renderer ready,
ownership transfer, destination layout commit, and source removal. Repeat with
source close, destination close, and renderer crash.

Pass:

- Before commit, source remains or returns editable.
- After commit, destination is sole editable owner.
- Restart reconciliation resolves uncertain reservations without duplication.

## E. Persistence, Migration, and Responsive Recovery — S6-TG05

### E1 — Normal restart

Create four windows with different group trees, active tabs, bounds, displays,
split sizes, drafts, and scroll anchors. Force-close and restart.

Pass:

- Same four stable windows restore within available displays.
- Valid groups/tabs/drafts/anchors restore without duplicating work.
- Active Chat ownership is singular after reconciliation.

### E2 — Over-limit legacy state

Restore a fixture containing six saved workbench windows.

Pass:

- Main plus three most-recently-focused valid auxiliaries open.
- Two layouts remain named and dormant.
- After closing one live window, either dormant layout can be restored intact.

### E3 — Missing display and small window

Remove a saved display and reopen a four-column layout on a smaller display.

Pass:

- Bounds clamp to an available display.
- Logical group tree remains saved.
- Excess visible groups collapse into labeled tabs with an explanation.
- Enlarging the window restores groups and sizes.

### E4 — Saved Workspace promotion and corruption

1. Save the current workbench as a Saved Workspace.
2. Restart and open it.
3. Corrupt one pane and interrupt one layout write.
4. Roll back to the last compatible single-group state.

Pass:

- Promotion references the existing Chats and does not duplicate runs/terminals.
- Valid panes restore around the corrupt pane's repair state.
- Interrupted write restores the last valid layout.
- Rollback preserves Chats, runs, drafts, files, and worktrees.

## F. Advanced Pane and Swarm Truth — S6-TG06/TG07

1. Open terminal, run/agent, worktree, diff, file, browser, fleet, lineage,
   activity, and task-path panes.
2. Exercise stale/missing targets and uncertain runtime state.
3. Select mixed-capability agents and preview pause/resume/cancel/steer.
4. Force one partial group-action failure.

Pass:

- Every pane names exact durable identity and provenance.
- No private reasoning or inferred/replayed terminal state appears.
- Group action preview lists exact selection, permissions, cascade, and budget.
- Result/audit names every success, failure, unsupported target, and unchanged target.

## G. Accessibility, Performance, and Cleanup — S6-TG07

Complete on supported platform/input combinations:

- Keyboard-only navigation across groups, tabs, sashes, windows, chooser,
  maximize/restore, join/close, and pull-back.
- VoiceOver on macOS, NVDA on Windows, and Orca on Linux.
- 80%, 100%, 150%, and 200% zoom; reduced motion; high contrast.
- Four panes in four workbench windows, inactive-tab suspension, terminal output
  flood, 100-agent projection fixture, and repeated open/close cycles.

Pass:

- No keyboard trap or color-only state.
- Active, selected, read-only, drop target, cap reached, and recovery states are
  named and announced.
- Declared CPU, memory, input, render, and cancellation budgets pass.
- Closing panes/windows returns renderer subscriptions, IPC listeners, terminal
  resources, window reservations, and ownership claims.

## Native Platform Matrix

| Platform                                    | Dev          | Package  | Cross-window drag | Multi-display | Screen reader | Status |
| ------------------------------------------- | ------------ | -------- | ----------------- | ------------- | ------------- | ------ |
| macOS supported architecture                | Required     | Required | Required          | Required      | VoiceOver     | Open   |
| Windows supported architecture              | Optional Dev | Required | Required          | Required      | NVDA          | Open   |
| Linux supported architecture/display server | Optional Dev | Required | Required          | Required      | Orca          | Open   |

Do not close an unobserved native row from a cross-build or another OS.

## Exit

S6-F6 closes only when:

- S6-F6-T1 through S6-F6-T10 are checked from current evidence.
- S6-TG01 through S6-TG07 pass on one exact candidate.
- Automated, Dev, native package, accessibility, multi-display, performance,
  restart, migration, corruption, and failure-injection evidence agree.
- No P0/P1 or acceptance-blocking defect remains.
- Support limits and recovery copy match this document and `ui-design.md`.

# S4-F4 — Saved Workspaces

### S4-F4-T1 — Define and migrate the saved workspace model

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F4
- Outcome: Versioned project/task workspace records reference existing objects safely.
- Scope: Schema, scope constraint, layout version, pane binding union, ordering, archive timestamps, migration, DTOs, and terminology boundary from legacy chat-as-workspace code.
- Out of scope: UI and broad legacy renames.
- Acceptance: Each workspace has one project or task scope; invalid pane data fails validation; existing chats remain unchanged.
- Verification: Migration, DTO, scope, malformed-layout, and supported-prior-schema tests.
- Blocked by: Stage 3 release baseline
- Blocks: S4-F4-T2, S4-F4-T3, S4-F4-T4, S4-F4-T5
- Context: project/task/chat schema, existing local workspace terminology.

### S4-F4-T2 — Add crash-safe workspace lifecycle

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F4
- Outcome: Users create, rename, duplicate, archive, restore, and delete saved workspaces without deleting referenced work.
- Scope: Service/router, optimistic versioning, atomic transaction, undo for archive, delete impact preview, list/filter/search, invalid-binding repair API.
- Out of scope: Pane rendering.
- Acceptance: Lifecycle survives restart and concurrent saves; delete removes only workspace metadata.
- Verification: CRUD, version conflict, crash transaction, archive/undo, delete, and reference-preservation tests.
- Blocked by: S4-F4-T1
- Blocks: S4-F4-T3, S4-F4-T5, S4-F4-T6, S4-F8-T1
- Context: project/task archive patterns, scoped search, tRPC invalidation.

### S4-F4-T3 — Build the bounded layout shell

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F4
- Outcome: A saved workspace renders versioned rows, columns, pane groups, and tabs.
- Scope: Workspace picker, create/save flow, split/tab shell, resize persistence, drag/reorder, four-chat cap, overflow tabs, empty/stale states, keyboard/accessibility.
- Out of scope: Freeform canvas and new nested chat navigation.
- Acceptance: Layout restores after restart; at most four chat panes render; all panes remain keyboard reachable.
- Verification: Layout reducer/property, persistence, cap, component, accessibility, and restart tests.
- Blocked by: S4-F4-T1, S4-F4-T2
- Blocks: S4-F4-T4, S4-F4-T5, S4-F4-T6
- Context: Agents shell, chat tabs, sidebar, `ui-design.md` future workspace layer.

### S4-F4-T4 — Bind chat, terminal, file, diff, and browser panes

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F4
- Outcome: Existing working surfaces can be added, removed, and restored in workspace panes.
- Scope: Chat bindings, fresh terminal restore policy, worktree binding, file/editor, diff, browser/web-link panes, pinned context, missing/stale repair states.
- Out of scope: A new IDE, remote browser service, or PTY process resurrection.
- Acceptance: Valid panes reuse existing data/services; missing targets do not block other panes; terminal process creation is explicit.
- Verification: Adapter, stale binding, terminal safety, worktree removal, file move, browser URL validation, and live pane tests.
- Blocked by: S4-F4-T1, S4-F4-T3
- Blocks: S4-F4-T6, S4-F6-T7
- Context: terminal, file viewer, diff views, URL link provider, worktree resolver.

### S4-F4-T5 — Add pop-outs and exclusive window ownership

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F4
- Outcome: Workspaces span windows without duplicate live chat control.
- Scope: Workspace window open/focus, stable IDs, chat claim integration, focus/move/skip recovery, pop-out/pull-back, close cleanup, crash recovery.
- Out of scope: Cross-device windows.
- Acceptance: No chat has two live owners; stale claims recover; pop-outs retain workspace and pane identity.
- Verification: Multi-window ownership, stale owner, focus, move, close, crash/restart, and race tests.
- Blocked by: S4-F4-T1, S4-F4-T2, S4-F4-T3
- Blocks: S4-F4-T6
- Context: `window-manager.ts`, window creation, existing open-chat ownership UI.

### S4-F4-T6 — Close saved workspace acceptance

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F4
- Outcome: A real project/task operating surface restores safely in Dev and packaged preview.
- Scope: Full gate, matrix S4-WS01 through S4-WS05, six-chat overflow, multi-window, stale worktree/file, crash recovery, docs and package preview.
- Out of scope: Remote synchronization.
- Acceptance: Workspace survives restart and one forced recovery; referenced work remains intact; ownership and stale states stay honest.
- Verification: `npm run check`, strict OpenSpec, `npm run dev:verify`, live multi-window walkthrough, and packaged preview evidence.
- Blocked by: S4-F4-T2, S4-F4-T3, S4-F4-T4, S4-F4-T5
- Blocks: Stage S4 integrated exit
- Context: `docs/stage4-full-feature-test-matrix.md`.

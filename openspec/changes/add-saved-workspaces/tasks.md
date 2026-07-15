# S4-F4 — Saved Workspaces

### S4-F4-T1 — Define and migrate the saved workspace model

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F4
- Outcome: Versioned project/task workspace records reference existing objects safely.
- Scope: Schema, scope constraint, `manual`/`orchestration` owner kind, unique orchestration link, layout version, pane binding union, roster projection, ordering, archive timestamps, migration, DTOs, and terminology boundary from legacy chat-as-workspace code.
- Out of scope: UI and broad legacy renames.
- Acceptance: Each workspace has one project or task scope; invalid pane data fails validation; existing chats remain unchanged.
- Verification: Migration, DTO, scope, malformed-layout, and supported-prior-schema tests.
- Evidence (2026-07-14): Added migration `0032_saved_workspaces`, constrained
  project/task scope, manual/orchestration ownership, opaque unique orchestration
  links, versioned and byte-bounded layout JSON, globally unique pane/node IDs,
  derived roster DTOs, ordering/version/archive metadata, and preserved existing
  chats. Node 22 migration/DTO/schema regressions pass 57/57 plus extension
  adjacency 13/13; TypeScript, focused ESLint/Prettier, production build, strict
  OpenSpec, and `git diff --check` pass.
- Blocked by: Stage 3 release baseline
- Blocks: S4-F4-T2, S4-F4-T3, S4-F4-T4, S4-F4-T5, S4-F4-T6
- Context: project/task/chat schema, existing local workspace terminology.

### S4-F4-T2 — Add crash-safe workspace lifecycle

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F4
- Outcome: Users create, rename, duplicate, archive, restore, and delete saved workspaces without deleting referenced work.
- Scope: Service/router, optimistic versioning, atomic transaction, undo for archive, delete impact preview, list/filter/search, invalid-binding repair API.
- Out of scope: Pane rendering.
- Acceptance: Lifecycle survives restart and concurrent saves; delete removes only workspace metadata.
- Verification: CRUD, version conflict, crash transaction, archive/undo, delete, and reference-preservation tests.
- Evidence (2026-07-14): Added a raw-SQL lifecycle service and tRPC router
  compatible with the finalized T1 table: immediate atomic transactions,
  optimistic versions, restart-safe create/save/rename/duplicate/archive/restore/delete,
  archive undo, metadata-only delete impact, scoped list/filter/search, malformed
  and stale binding repair, and explicit query invalidation hints. Node 22
  lifecycle/router tests pass 8/8; TypeScript, focused ESLint/Prettier,
  production build, strict OpenSpec, and `git diff --check` pass.
- Blocked by: S4-F4-T1
- Blocks: S4-F4-T3, S4-F4-T5, S4-F4-T6, S4-F4-T7, S4-F8-T1
- Context: project/task archive patterns, scoped search, tRPC invalidation.

### S4-F4-T3 — Build the bounded layout shell

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F4
- Outcome: A saved workspace renders versioned rows, columns, pane groups, and tabs.
- Scope: Workspace picker, create/save flow, split/tab shell, resize persistence, drag/reorder, four-chat cap, overflow tabs, empty/stale states, keyboard/accessibility.
- Out of scope: Freeform canvas and new nested chat navigation.
- Acceptance: Layout restores after restart; at most four chat panes render; all panes remain keyboard reachable.
- Verification: Layout reducer/property, persistence, cap, component, accessibility, and restart tests.
- Evidence (2026-07-14): Added the Saved workspaces shell entry point,
  project-scoped picker/create/save flow, restart selection, debounced optimistic
  layout persistence, versioned row/column splits, keyboard/pointer resize,
  draggable/reorderable tab groups, malformed/empty/stale repair states, and a
  reducer-enforced four-visible-chat cap that retains overflow as tabs. Node 22
  focused lifecycle/router, reducer/property, persistence, cap, component,
  accessibility, restart, same-workspace and cross-workspace concurrent-save,
  immediate-switch recovery, unload protection, and split-size tests pass
  25/25; TypeScript, focused ESLint, Prettier, production build, strict OpenSpec,
  and `git diff --check` pass. Live Dev and package walkthroughs remain
  unobserved and are not claimed by T3.
- Blocked by: S4-F4-T1, S4-F4-T2
- Blocks: S4-F4-T4, S4-F4-T5, S4-F4-T6, S4-F4-T7
- Context: Agents shell, chat tabs, sidebar, `ui-design.md` future workspace layer.

### S4-F4-T4 — Bind chat, terminal, file, diff, and browser panes

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F4
- Outcome: Existing working surfaces can be added, removed, and restored in workspace panes.
- Scope: Chat bindings, fresh terminal restore policy, worktree binding, file/editor, diff, browser/web-link panes, pinned context, missing/stale repair states.
- Out of scope: A new IDE, remote browser service, or PTY process resurrection.
- Acceptance: Valid panes reuse existing data/services; missing targets do not block other panes; terminal process creation is explicit.
- Verification: Adapter, stale binding, terminal safety, worktree removal, file move, browser URL validation, and live pane tests.
- Automated evidence: Node 22 integrated saved-workspace coverage passed 7 files/25 tests, including current-data chat panes, explicit fresh-terminal activation using only the resolver-verified canonical cwd, file/diff/browser bindings, registered-root and symlink denial, isolated missing/stale repair, pinned context, max-length duplicate identities, persistence, keyboard controls, and accessibility. Integrated TypeScript, focused ESLint, Prettier, diff check, strict OpenSpec, and the production build passed. No live Dev or package claim is inferred.
- Blocked by: S4-F4-T1, S4-F4-T3
- Blocks: S4-F4-T6, S4-F4-T7, S4-F6-T7
- Context: terminal, file viewer, diff views, URL link provider, worktree resolver.

### S4-F4-T5 — Add pop-outs and exclusive window ownership

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F4
- Outcome: Workspaces span windows without duplicate live chat control.
- Scope: Workspace window open/focus, stable IDs, chat claim integration, focus/move/skip recovery, pop-out/pull-back, close cleanup, crash recovery.
- Out of scope: Cross-device windows.
- Acceptance: No chat has two live owners; stale claims recover; pop-outs retain workspace and pane identity.
- Verification: Multi-window ownership, stale owner, focus, move, close, crash/restart, and race tests.
- Evidence (2026-07-14): Added stable full-workspace, pane-pop-out, and
  remainder windows; atomic exclusive pane/chat claims; exact compare-and-release;
  focus/move/skip/pull-back recovery; close and renderer-crash/reload cleanup;
  stable-ID recovery without duplicate windows; cross-window invalidation; exact
  workspace/pane/remainder routing; structurally read-only derived layouts; and
  keyboard/live-region controls. Node 22 integrated ownership/component coverage
  passes 32/32, including zero-chat panes, stale target completion, A-to-B/shared
  binding reconciliation, crash/reload uniqueness, focus, move, pull-back, close,
  route normalization, and restart cases. Integrated TypeScript, focused
  ESLint/Prettier, production build, strict OpenSpec, and diff check pass. Live
  Dev and packaged multi-window walkthroughs remain unobserved and belong to T7.
- Blocked by: S4-F4-T1, S4-F4-T2, S4-F4-T3
- Blocks: S4-F4-T7
- Context: `window-manager.ts`, window creation, existing open-chat ownership UI.

### S4-F4-T6 — Add orchestration-owned operation workspaces

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F4
- Outcome: Starting multi-agent work opens one durable workspace containing the lead and every descendant agent chat.
- Scope: Transactional/recoverable orchestration link, initiating-chat roster, dynamic descendant roster, lead/navigator/selected-agent/activity default layout, workspace open/focus, status and artifact bindings, large-team overflow, archive/delete impact preview, and lineage-based regeneration.
- Out of scope: Rendering every agent simultaneously, duplicating chat/run data, or deleting/stopping work through workspace deletion.
- Acceptance: Every new orchestration has one operation workspace; newly materialized chats appear once; the four-chat cap holds; restart repairs half-created links without replay; deleting workspace metadata preserves all work.
- Verification: Creation-order race, unique link, dynamic spawn, selected-agent swap, cap/overflow, restart repair, deletion preservation, regeneration, accessibility, and live heterogeneous orchestration tests.
- Blocked by: S4-F4-T1, S4-F4-T2, S4-F4-T3, S4-F4-T4, S4-F3-T6, S4-F3-T7, S4-F3-T8
- Blocks: S4-F3-T10, S4-F4-T7, S4-F12-T6
- Context: orchestration agent chat IDs, workspace service/router, lineage graph, agent activity timeline.

### S4-F4-T7 — Close saved workspace acceptance

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F4
- Outcome: A real project/task operating surface restores safely in Dev and packaged preview.
- Scope: Full gate, matrix S4-WS01 through S4-WS06, manual and operation workspaces, six-chat overflow, multi-window, stale worktree/file, crash recovery, docs and package preview.
- Out of scope: Remote synchronization.
- Acceptance: Manual and operation workspaces survive restart and one forced recovery; descendant rosters reconcile; referenced work remains intact; ownership and stale states stay honest.
- Verification: `npm run check`, strict OpenSpec, `npm run dev:verify`, live multi-window walkthrough, and packaged preview evidence.
- Blocked by: S4-F4-T2, S4-F4-T3, S4-F4-T4, S4-F4-T5, S4-F4-T6
- Blocks: Stage S4 integrated exit
- Context: `docs/stage4-full-feature-test-matrix.md`.

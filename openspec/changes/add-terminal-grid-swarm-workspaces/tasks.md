# S6-F6 — Multi-Pane Chat and Swarm Workspaces

### S6-F6-T1 — Lock the Chat-group, floating-window, and advanced-grid contract

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F6
- Outcome: VS Code reference behavior and current Flapstack foundations become one implementable contract over existing identities and authority.
- Scope: Map top-level Chat tabs, legacy internal split, Saved Workspace shell, Chat ownership, ActiveChat boundaries, and every `createWindow` caller; record VS Code group/drop/floating behavior; lock four-visible-Chat-per-window and four-workbench-window-total limits, counted/exempt window kinds, presets, shared vs pane-local chrome, responsive minimums, move/copy semantics, fleet/group controls, and non-goals; run a disposable Electron cross-window drag spike on macOS, Windows, and Linux or record the native host proof blocker for each unobserved OS.
- Out of scope: Implementation or copying external code.
- Acceptance: No second scheduler/task/Chat model; every pane/action maps to a current service; a tab move never inserts a Chat; main plus three auxiliary workbench windows is the only counted maximum; exact in-window/cross-window drag events and fallbacks are documented; default UI remains single-pane until used.
- Verification: Architecture/UX/security review, source mapping table, official VS Code behavior citations, and platform drag-spike evidence/blocker table.
- Blocked by: accepted S4-F3/F4/F11
- Blocks: S6-F6-T2, S6-F6-T3, S6-F6-T4, S6-F6-T5, S6-F6-T6, S6-F6-T7, S6-F6-T8
- Context: `src/renderer/features/agents/ui/agents-content.tsx`, `src/renderer/features/agents/main/active-chat.tsx`, `src/renderer/features/agents/ui/split-view-container.tsx`, `src/renderer/features/saved-workspaces/`, `src/main/windows/`, official VS Code User Interface and Custom Layout docs.

### S6-F6-T2 — Build the reusable full-Chat pane and bounded group tree

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F6
- Outcome: One window can render one to four complete, independently operable top-level Chats in a versioned row/column group tree.
- Scope: Extract a reusable Chat workbench pane from the one-selected-Chat route; pane-local header/transcript/vertical scrollbar/timeline/composer/draft/run/stream/error/focus; shared-sidebar and active-pane details contract; recursive split/group reducer; sashes; maximize/restore; Single, Two Columns, Two Rows, Three Columns, Three Rows, Grid 2x2, Two Rows Right, Two Columns Bottom, Four Columns, and Four Rows layouts; group normalization; responsive minimum/collapse; inactive-tab suspension.
- Out of scope: Pointer drop zones, cross-window transfer, fleet projection, and group agent controls.
- Acceptance: Four Chats can send and stream concurrently with independent drafts, focus, scroll anchors, errors, approvals, and composers; closing a pane changes presentation only; no nested/internal `sub_chat` identity leaks into UI.
- Verification: Reducer/property/component/state-isolation/focus/IME/scroll/simultaneous-stream/resource tests, stable visual fixtures for every preset, and keyboard/reader checks for sashes and group focus.
- Blocked by: S6-F1-T3, S6-F1-T7, S6-F6-T1
- Blocks: S6-F6-T3, S6-F6-T7, S6-F6-T8, S6-F6-T9
- Context: `AgentsContent`, `ActiveChat`, `ChatViewInner`, open-Chat atoms/tests, Saved Workspace layout reducer/shell, composer draft and streaming stores.

### S6-F6-T3 — Add directional tab drag/drop and authoritative pane binding

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F6
- Outcome: Users reorder tabs, tab Chats together, or create left/right/top/bottom splits with a truthful preview while every pane resolves exact durable identity.
- Scope: Replace renderer-only pointer reorder with versioned drag sessions; tab-strip insertion; center and edge drop overlays; Escape/cancel; capacity/minimum-size rejection; context-menu and command equivalents; focus after move; bind Chat/terminal/run/agent/worktree/diff/file/browser panes; target validation; stale/missing state; same-window ownership and lifecycle cleanup.
- Out of scope: Fleet projection and group control.
- Acceptance: The preview equals the committed tree; invalid or fifth-group drops leave source unchanged and offer tab/new-window recovery; no duplicate Chat control; wrong-project targets fail; closing a pane does not delete work; stale state never guesses.
- Verification: Drag-session/reducer/drop-overlay/keyboard/touch/binding/access/ownership/stale/cancel/cleanup tests plus live reorder, center-drop, four directional drops, asymmetric three-pane, 2x2, four-column, and cap walkthroughs.
- Blocked by: S6-F6-T1, S6-F6-T2
- Blocks: S6-F6-T4, S6-F6-T5, S6-F6-T6, S6-F6-T7, S6-F6-T8, S6-F6-T10
- Context: top-level Chat tab pointer logic, Saved Workspace tab drag/reducer, pane adapters, DB access scopes, window ownership.

### S6-F6-T4 — Add fleet, lineage, activity, and task-path projections

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F6
- Outcome: Dense grid users understand every agent's role, runtime, lineage, task path, budget, progress, and recovery state.
- Scope: Fleet pane; lineage/graph; selected-agent details; ordered activity; workflow/mailbox/dependency events; filters; warnings; usage; navigation.
- Out of scope: New provider parsers or private reasoning.
- Acceptance: Provenance remains exact; terminal/uncertain states do not replay; 100-agent fixture remains responsive.
- Verification: Projection/order/dedupe/restart/100-agent/performance/accessibility tests.
- Blocked by: S6-F6-T1, S6-F6-T3, S6-F7-T5
- Blocks: S6-F6-T5, S6-F6-T9, S6-F6-T10
- Context: F3 fleet/lineage, F11 activity, task tree/mailboxes.

### S6-F6-T5 — Add previewed bounded group controls

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F6
- Outcome: Users select exact agents and safely pause, resume, cancel, or steer with per-target results.
- Scope: Selection model; action preview; capability/permission matrix; approval; cascade; idempotency; partial results; audit; undo only where service supports it.
- Out of scope: Spawn-all, arbitrary terminal commands, merge/push/deploy.
- Acceptance: Selection/version staleness fails; unsupported targets remain unchanged; result/audit lists every target.
- Verification: Selection/stale/approval/partial/cascade/revoke/audit tests and live mixed-runtime walkthrough.
- Blocked by: S6-F6-T1, S6-F6-T3, S6-F6-T4, S6-F7-T4
- Blocks: S6-F6-T10
- Context: orchestration cascade control, runtime controls, approval coordinator.

### S6-F6-T6 — Enforce the four-workbench-window budget

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F6
- Outcome: Every path that can create a visible Flapstack workbench window obeys one race-safe app-wide limit of four, including main.
- Scope: Add shared constants/types and main-process `WindowBudget`; classify main/Chat/Saved Workspace windows as counted and dialogs/native pickers/capture overlays/hidden utilities as exempt; reserve/commit/release/expire slots; enumerate/focus existing destinations; route tab drag-out, New Window, Move/Copy into New Window, workspace pane pop-out/remainder, restore, and API/automation callers through the budget; expose typed `available`, `at-limit`, and `reservation-expired` results; log sanitized diagnostics.
- Out of scope: Moving Chats between windows, layout persistence, or limiting OS dialogs.
- Acceptance: Main plus three auxiliary workbench windows succeeds; every fifth concurrent creation is rejected before `BrowserWindow` construction; simultaneous requests cannot overbook the fourth slot; rejection leaves tabs, Chat ownership, drafts, and layouts unchanged; destroying a counted window releases exactly one slot; exempt surfaces still open.
- Verification: Unit/property tests for reservations and expiry; concurrent IPC tests over every creation handler; destroyed/recovering renderer cases; destination-list redaction; fake-clock leak tests; live four-window/fifth-request walkthrough.
- Blocked by: S6-F6-T1, S6-F6-T3
- Blocks: S6-F6-T7, S6-F6-T8, S6-F6-T9, S6-F6-T10
- Context: `src/main/windows/window-manager.ts`, `src/main/windows/main.ts`, `src/main/index.ts`, preload desktop API, sidebar New Window actions, Saved Workspace pop-outs, tests/workspace-window-ownership.test.ts.

### S6-F6-T7 — Implement atomic drag-out and cross-window Chat transfer

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F6
- Outcome: A Chat tab moves between groups/windows or into a new floating Flapstack window with no duplicate identity, editable owner, or lost local state.
- Scope: Electron main-process drag coordinator; opaque expiring drag sessions; registered-window screen bounds/drop targets; destination reservation; destination-ready handshake; compare-and-transfer Chat ownership; source commit/rollback; same-window and cross-window drop; outside-drop window creation; pull-back; Move into New Window command; read-only Copy into New Window; focus restoration; cap-reached destination chooser; source/destination close and renderer-crash recovery.
- Out of scope: Persisting window bounds/layouts across restart and cross-device windows.
- Acceptance: Outside-drop with a free slot opens one floating window containing the same Chat ID; source removal occurs only after destination readiness and ownership transfer; drop onto another window targets its previewed group/edge; destination failure restores source; fifth-window attempts offer existing destinations; read-only copy cannot send or mutate Chat settings; no transcript/credential content enters drag IPC.
- Verification: IPC schema/nonce/expiry/replay tests; ownership CAS and fault injection at every transfer phase; screen-coordinate/multi-display target tests; source/destination close races; live drag within/across/outside windows; command fallback; pull-back; cap chooser; native macOS/Windows/Linux package evidence.
- Blocked by: S6-F1-T7, S6-F6-T1, S6-F6-T2, S6-F6-T3, S6-F6-T6
- Blocks: S6-F6-T8, S6-F6-T9, S6-F6-T10
- Context: `WindowManager`, `createWindow`, preload IPC, `WindowContext`, top-level Chat drag controller, Saved Workspace ownership boundary.

### S6-F6-T8 — Persist, migrate, and restore window/group/workspace layouts

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F6
- Outcome: Normal and Saved Workspace layouts restore crash-safely within the four-window budget without changing underlying work.
- Scope: Versioned window-session schema; stable IDs; kind/project/workspace target; display/bounds/compact state; group tree, active group/tab, split sizes, drafts/scroll-anchor references; atomic autosave; `openChatIds` single-group migration; prior Saved Workspace layout adapter; Save as Workspace/template lifecycle; dormant overflow when saved state exceeds four windows; most-recently-focused restore order; missing-display clamp; stale/missing repair; import/export; rollback and last-compatible state.
- Out of scope: Persisting running PTY processes, copying Chat/run records, hosted layout sync, or auto-opening more than four workbench windows.
- Acceptance: Main plus three most-recent valid auxiliary windows restore; excess saved windows remain named/dormant/recoverable; corrupt window or pane does not block other restores; drafts and active runs remain associated with exact Chat IDs; template apply never duplicates Chats/runs/terminals; rollback returns to one compatible group.
- Verification: Schema/migration/property tests; interrupted-write/corruption/fault injection; more-than-four legacy fixture; display removal; stale target; import/export; Save as Workspace; crash/restart; rollback/reopen; Dev and packaged restore walkthroughs.
- Blocked by: S6-F1-T7, S6-F6-T1, S6-F6-T2, S6-F6-T3, S6-F6-T6, S6-F6-T7
- Blocks: S6-F6-T9, S6-F6-T10
- Context: window-scoped storage, Saved Workspace schema/service, portability, `WindowContext`, app startup/restore ordering.

### S6-F6-T9 — Prove accessibility and scale under multi-pane workloads

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F6
- Outcome: Grid remains operable with keyboard/reader and within explicit CPU/memory/render budgets.
- Scope: Roving group/tab/window focus; split/move/resize/maximize/window commands; cap-reached destination chooser; drag preview announcements; focus restoration; zoom; color; reduced motion; responsive collapse; four simultaneous full Chat panes in each of four windows; virtualization; terminal backpressure; inactive suspension; 20/50/100 advanced panes/agents; listener/window/renderer leak tests.
- Out of scope: Overall app performance owned by F9.
- Acceptance: No keyboard trap; selected/active/readonly/window-limit state is non-color and announced; typing and streaming remain within budgets at supported multi-pane/window limits; closing tabs/windows returns subscriptions, renderer resources, and reservations.
- Verification: Accessibility matrix; VoiceOver/NVDA/Orca; keyboard-only four-window workflow; 80-200% zoom and reduced motion; deterministic performance harness; heap/process/listener/resource snapshots; 24-hour soak.
- Blocked by: S6-F6-T2, S6-F6-T4, S6-F6-T6, S6-F6-T7, S6-F6-T8, S6-F9-T2
- Blocks: S6-F6-T10, S6-F9-T6
- Context: Stage 6 budgets, terminal process manager, virtualization.

### S6-F6-T10 — Close multi-pane Chat and swarm workspace acceptance

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F6
- Outcome: Full Chat panes, directional drag, floating windows, binding, fleet, group control, persistence, scale, and accessibility pass one exact build.
- Scope: Matrix S6-TG; every preset and directional/mirrored layout; four simultaneous send/stream/scroll/composer flows; fifth-group handling; four total workbench windows and every fifth-window path; drag outside and between windows; command fallback; source/destination crash; same-window and cross-window ownership; dormant restore overflow; simple/advanced entry; restart; responsive collapse; stale targets; mixed runtimes; group partial failure; manual test plan, support limits, recovery docs, and packages.
- Out of scope: Hidden autonomous swarm creation.
- Acceptance: Dense view never changes identity/authority truth; default users are not forced into it; all failure states remain recoverable.
- Verification: Node 22 `npm run check`, strict OpenSpec, verified Dev, live multi-agent/multi-window/multi-display/accessibility/performance, and native packaged macOS/Windows/Linux preview evidence.
- Blocked by: S6-F6-T3, S6-F6-T4, S6-F6-T5, S6-F6-T6, S6-F6-T7, S6-F6-T8, S6-F6-T9, S6-F7-T7
- Blocks: S6-F11-T3, S6-F11-T5, S6-F11-T6
- Context: `docs/stage6-full-feature-test-matrix.md` and `docs/stage6-multi-pane-chat-window-test-plan.md`.

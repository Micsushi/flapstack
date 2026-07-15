# S5-F6 — Terminal-Grid and Swarm Workspaces

### S5-F6-T1 — Lock advanced-grid boundaries and interaction model

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F6
- Outcome: Reference ideas become a Flapstack-native design over existing identities and authority.
- Scope: BridgeMind/Space review; pane types; simple vs advanced entry; chat ownership; grid limits; fleet/lineage projection; group action catalog; keyboard model; non-goals.
- Out of scope: Implementation or copying external code.
- Acceptance: No second scheduler/task/chat model; every pane/action maps to a Stage 4 service; default UI remains uncluttered.
- Verification: Architecture/UX/security review and mapping table.
- Blocked by: accepted S4-F3/F4/F11
- Blocks: S5-F6-T2, S5-F6-T3, S5-F6-T4, S5-F6-T5, S5-F6-T6
- Context: saved workspaces, fleet, lineage, pane adapters, external research.

### S5-F6-T2 — Build virtualized terminal/chat/agent grid layout

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F6
- Outcome: Users add, resize, move, tab, maximize, and remove bounded panes in advanced workspace mode.
- Scope: Layout reducer; pane chrome; templates; drag/keyboard move/resize; virtualization; focus; density; responsive fallback; limits; empty state.
- Out of scope: Binding live objects and persistence.
- Acceptance: Limits fail visibly; keyboard parity exists; inactive panes do not consume unbounded renderer/terminal resources.
- Verification: Reducer/property/component/performance/accessibility and visual fixture tests.
- Blocked by: S5-F1-T3, S5-F1-T7, S5-F6-T1
- Blocks: S5-F6-T3, S5-F6-T6, S5-F6-T7
- Context: workspace layout reducer, pane components, terminal renderer.

### S5-F6-T3 — Bind panes to authoritative chats, terminals, worktrees, and inspections

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F6
- Outcome: Every pane shows exact durable identity and respects exclusive control ownership.
- Scope: Pane adapters; chat/terminal/run/agent/worktree/diff/file/browser; ownership claim/mirror/move; target validation; stale/missing state; navigation; lifecycle cleanup.
- Out of scope: Fleet projection and group control.
- Acceptance: No duplicate chat control; wrong-project targets fail; closing pane does not delete work; stale state never guesses.
- Verification: Binding/access/ownership/two-window/stale/cleanup/restart tests.
- Blocked by: S5-F6-T1, S5-F6-T2
- Blocks: S5-F6-T4, S5-F6-T5, S5-F6-T6, S5-F6-T8
- Context: saved workspace pane adapters, DB access scopes, window ownership.

### S5-F6-T4 — Add fleet, lineage, activity, and task-path projections

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F6
- Outcome: Dense grid users understand every agent's role, runtime, lineage, task path, budget, progress, and recovery state.
- Scope: Fleet pane; lineage/graph; selected-agent details; ordered activity; workflow/mailbox/dependency events; filters; warnings; usage; navigation.
- Out of scope: New provider parsers or private reasoning.
- Acceptance: Provenance remains exact; terminal/uncertain states do not replay; 100-agent fixture remains responsive.
- Verification: Projection/order/dedupe/restart/100-agent/performance/accessibility tests.
- Blocked by: S5-F6-T1, S5-F6-T3, S5-F7-T5
- Blocks: S5-F6-T5, S5-F6-T7, S5-F6-T8
- Context: F3 fleet/lineage, F11 activity, task tree/mailboxes.

### S5-F6-T5 — Add previewed bounded group controls

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F6
- Outcome: Users select exact agents and safely pause, resume, cancel, or steer with per-target results.
- Scope: Selection model; action preview; capability/permission matrix; approval; cascade; idempotency; partial results; audit; undo only where service supports it.
- Out of scope: Spawn-all, arbitrary terminal commands, merge/push/deploy.
- Acceptance: Selection/version staleness fails; unsupported targets remain unchanged; result/audit lists every target.
- Verification: Selection/stale/approval/partial/cascade/revoke/audit tests and live mixed-runtime walkthrough.
- Blocked by: S5-F6-T1, S5-F6-T3, S5-F6-T4, S5-F7-T4
- Blocks: S5-F6-T8
- Context: orchestration cascade control, runtime controls, approval coordinator.

### S5-F6-T6 — Persist grid templates and restore across windows/restart

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F6
- Outcome: User and operation grid layouts restore crash-safely without changing underlying work.
- Scope: Versioned layout mode; templates; save/rename/duplicate/archive; operation roster; crash-safe writes; window ownership; stale repair; export/import; rollback.
- Out of scope: Hosted shared layouts.
- Acceptance: Existing workspaces unchanged; corrupt pane does not block others; template apply never duplicates chats/runs/terminals.
- Verification: Migration/rollback, fault injection, two-window, roster, import/export, and restart tests.
- Blocked by: S5-F1-T7, S5-F6-T1, S5-F6-T2, S5-F6-T3
- Blocks: S5-F6-T7, S5-F6-T8
- Context: saved workspace schema/service, portability.

### S5-F6-T7 — Prove accessibility and scale under dense workloads

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F6
- Outcome: Grid remains operable with keyboard/reader and within explicit CPU/memory/render budgets.
- Scope: Roving focus; shortcuts; announcements; zoom; color; virtualization; terminal backpressure; inactive suspension; 20/50/100 panes/agents; leak tests.
- Out of scope: Overall app performance owned by F9.
- Acceptance: No keyboard trap; selected/active state is non-color; limits remain responsive and cleanup returns resources.
- Verification: Accessibility matrix, performance harness, heap/resource snapshots, long-run soak.
- Blocked by: S5-F6-T2, S5-F6-T4, S5-F6-T6, S5-F9-T2
- Blocks: S5-F6-T8, S5-F9-T6
- Context: Stage 5 budgets, terminal process manager, virtualization.

### S5-F6-T8 — Close terminal-grid and swarm workspace acceptance

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F6
- Outcome: Layout, binding, fleet, group control, persistence, scale, and accessibility pass one exact build.
- Scope: Matrix S5-TG; simple/advanced entry; multi-window; restart; stale targets; mixed runtimes; group partial failure; package/docs.
- Out of scope: Hidden autonomous swarm creation.
- Acceptance: Dense view never changes identity/authority truth; default users are not forced into it; all failure states remain recoverable.
- Verification: Node 22 npm run check, strict OpenSpec, verified Dev, live multi-agent/multi-window/accessibility/performance, packaged preview.
- Blocked by: S5-F6-T3, S5-F6-T4, S5-F6-T5, S5-F6-T6, S5-F6-T7, S5-F7-T7
- Blocks: S5-F11-T3, S5-F11-T5, S5-F11-T6
- Context: docs/stage5-full-feature-test-matrix.md.

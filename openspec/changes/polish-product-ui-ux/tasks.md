# S5-F1 — Product-wide UI/UX Polish

### S5-F1-T1 — Audit every user-facing surface and set usability baselines

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F1
- Outcome: One inventory identifies every production route, control, state, ownership boundary, and measurable usability problem.
- Scope: Route/component inventory; current screenshots; task timings; navigation depth; duplicate controls; inaccessible paths; stale copy; responsive/multi-window gaps; ranked P0-P2 findings.
- Out of scope: UI implementation.
- Acceptance: Every Stage 1-4 feature has an owner surface and test path; findings name evidence and target behavior.
- Verification: Inventory link check, fixture capture, keyboard scan, axe scan, and reviewed baseline walkthrough.
- Blocked by: fully accepted Stage 4 exact SHA
- Blocks: S5-F1-T2, S5-F1-T3, S5-F1-T4, S5-F1-T5, S5-F1-T6, S5-F1-T7, S5-F1-T8
- Context: root ui-design.md, renderer routes, Stage 4 matrix, Settings visibility registry.

### S5-F1-T2 — Establish shared visual, density, responsive, and state primitives

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F1
- Outcome: Feature screens reuse one token/component/state foundation.
- Scope: Color/type/spacing/density tokens; focus/contrast; buttons/fields/cards/tabs/chips; empty/loading/stale/error/recovery patterns; responsive breakpoints; motion policy; Storybook-equivalent fixture gallery.
- Out of scope: Feature-specific layout migrations.
- Acceptance: Primitives meet contrast/focus/zoom requirements and cover every audited state without provider-specific forks.
- Verification: Component tests, axe, 200% zoom, reduced-motion, dark/light themes, and approved visual fixtures.
- Blocked by: S5-F1-T1
- Blocks: S5-F1-T3, S5-F1-T4, S5-F1-T5, S5-F1-T6, S5-F1-T7, S5-F1-T8, S5-F2-T4, S5-F3-T4, S5-F12-T6
- Context: Tailwind theme, Radix primitives, current shared components.

### S5-F1-T3 — Refine navigation, sidebar, hierarchy, and discovery

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F1
- Outcome: Users find projects, tasks, chats, workspaces, advanced areas, archives, and Settings with less ambiguity.
- Scope: Sidebar hierarchy; pinned/archive/search; selected/active states; breadcrumbs; direct routes; compact/expanded density; overflow; window ownership; empty first project.
- Out of scope: Onboarding visibility presets.
- Acceptance: No nested-chat model returns; active scope is always visible; every destination is keyboard/search reachable.
- Verification: Navigation tests, deep-link/restart fixtures, keyboard walkthrough, responsive screenshots, and task-timing comparison to T1.
- Blocked by: S5-F1-T1, S5-F1-T2
- Blocks: S5-F1-T9, S5-F2-T4, S5-F4-T5, S5-F6-T2
- Context: AgentsSidebar, App routing, workspace navigation, single-conversation contract.

### S5-F1-T4 — Refine chat, composer, run, and details workflows

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F1
- Outcome: Starting, understanding, steering, reviewing, and recovering an agent run is clear and consistent.
- Scope: Header hierarchy; composer controls; model/tuning/profile/worktree/permission previews; streaming/tool/reasoning rows; question/approval cards; Review/Undo; details panel; terminal/diff/file transitions.
- Out of scope: New runtime/provider capabilities.
- Acceptance: Launch-critical choices are visible before run; secondary data does not crowd the header; blocked/recovery state names exact action.
- Verification: Renderer tests, provider fixtures, keyboard/zoom/reader walkthrough, long transcript, cancellation, retry, and conflict Review/Undo.
- Blocked by: S5-F1-T1, S5-F1-T2
- Blocks: S5-F1-T9, S5-F3-T5
- Context: active chat, input area, runtime activity, details sidebar, question/approval UI.

### S5-F1-T5 — Rebuild Settings information architecture and alphabetical categories

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F1
- Outcome: Settings categories are alphabetically ordered, searchable, provider-accurate, and consistently structured.
- Scope: Top-level alphabetical ordering by displayed label; page templates; search index; keywords; deep-link/focus/highlight; advanced sections; hidden-feature routes; dirty/save/error behavior.
- Out of scope: Onboarding questionnaire and visibility persistence.
- Acceptance: Search finds every eligible setting; hidden UI features remain configurable; category order is deterministic across platforms/locales.
- Verification: Registry/order/search/deep-link tests, keyboard flow, stale route normalization, and accessibility walkthrough.
- Blocked by: S5-F1-T1, S5-F1-T2
- Blocks: S5-F1-T9, S5-F2-T6, S5-F3-T4
- Context: Settings sidebar/content/search, settings-navigation spec.

### S5-F1-T6 — Add progress capsule, timeline preview, and unified feedback

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F1
- Outcome: Long-running work and long conversations are glanceable without losing full detail.
- Scope: Plan/run progress capsule; current step/change counts; transcript timeline/minimap; previews; jump/focus; grouped long histories; toast/inbox/progress consistency; unavailable metric hiding.
- Out of scope: New plan execution engine.
- Acceptance: Summary never invents zero/progress; timeline supports keyboard/touch; full detail remains one action away.
- Verification: 10k-message fixture, active/completed/failed runs, keyboard/touch/reader tests, visual fixtures, and performance budget.
- Blocked by: S5-F1-T1, S5-F1-T2
- Blocks: S5-F1-T9, S5-F9-T4
- Context: root ui-design.md progress/timeline sections, Plan view, runtime activity.

### S5-F1-T7 — Refine saved workspaces and multi-window behavior

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F1
- Outcome: Dense layouts remain understandable, restorable, and ownership-safe.
- Scope: Pane chrome; layout editing; tabs/pop-outs; four-chat boundary; focus/open-here; stale targets; resize; terminal/file/diff/browser panels; crash-safe restore.
- Out of scope: Terminal-grid/swarm feature logic.
- Acceptance: No duplicate chat control; invalid panes do not block remaining workspace; layout edits remain reversible.
- Verification: Multi-window component/integration tests, forced restart, missing-target fixtures, 200% zoom, and live workspace walkthrough.
- Blocked by: S5-F1-T1, S5-F1-T2
- Blocks: S5-F1-T9, S5-F6-T2, S5-F6-T6
- Context: S4 saved workspaces, window ownership, pane adapters.

### S5-F1-T8 — Close accessibility, voice-language, and recovery-state gaps

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F1
- Outcome: Every audited critical workflow has complete accessible names, focus, copy, errors, and recovery.
- Scope: WCAG-oriented audit; screen-reader landmarks/live regions; keyboard traps; color-only cues; localization-safe layout; plain-language microcopy; bounded inspectable dynamic speech vocabulary; transcript review; destructive confirmation; offline/stale/permission errors.
- Out of scope: Full localization translation program.
- Acceptance: No critical/serious automated issue; every primary flow completes keyboard-only and with supported screen reader; vocabulary hints stay scoped/inspectable and never auto-submit; errors name cause and next step.
- Verification: axe, Playwright/component accessibility fixtures where available, VoiceOver/NVDA/Orca matrix, keyboard walkthrough, contrast/zoom checks, and local/cloud speech fixtures for approved, unsupported, stale, and private terms.
- Blocked by: S5-F1-T1, S5-F1-T2
- Blocks: S5-F1-T9, S5-F11-T5
- Context: audit inventory, root ui-design.md, platform accessibility APIs.

### S5-F1-T9 — Close product-wide UI/UX acceptance

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F1
- Outcome: One exact SHA passes automated visual/accessibility gates and observed end-to-end usability.
- Scope: Matrix S5-UX; visual fixtures; task-time comparison; novice/power-user walkthroughs; responsive/multi-window; clean profile; upgrade; docs and known limitations.
- Out of scope: Closing other Stage 5 feature acceptance.
- Acceptance: Required P0/P1 audit findings are closed; no primary flow regresses; remaining P2/P3 items have explicit owners.
- Verification: Node 22 npm run check, strict OpenSpec, verified Dev, visual regression, accessibility matrix, and observed usability walkthrough.
- Blocked by: S5-F1-T3, S5-F1-T4, S5-F1-T5, S5-F1-T6, S5-F1-T7, S5-F1-T8
- Blocks: S5-F11-T5
- Context: docs/stage5-full-feature-test-matrix.md and T1 audit.

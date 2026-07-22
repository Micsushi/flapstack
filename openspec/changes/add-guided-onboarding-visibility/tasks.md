# S6-F2 — Guided Onboarding and Feature Visibility

### S6-F2-T1 — Lock questionnaire, presets, and always-visible core

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F2
- Outcome: Questions and Focused/Standard/Complete preset outputs are explicit and reviewable.
- Scope: Question wording/options; scoring-free deterministic mapping; preset definitions; always-visible core; optional feature catalog; prerequisites; first-install and existing-user behavior.
- Out of scope: Persistence and UI.
- Acceptance: Every answer set produces one explainable diff; no answer can hide safety/recovery; one-to-two-agent path avoids advanced UI by default.
- Verification: Decision-table tests and product/UX/security review.
- Blocked by: fully accepted Stage 5 feature baseline
- Blocks: S6-F2-T2, S6-F2-T4, S6-F2-T5
- Context: Stage 1-4 feature routers, Settings registry, future considerations.

### S6-F2-T2 — Build the authoritative feature visibility registry

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F2
- Outcome: Navigation, onboarding, Settings, search, and help resolve visibility from one typed registry.
- Scope: Stable IDs; labels/categories/descriptions; preset defaults; prerequisites; route/search ownership; always-discoverable flag; unknown-version behavior; dev-only exclusion.
- Out of scope: UI and preference storage.
- Acceptance: Duplicate/missing IDs fail; every production optional surface registers once; hidden state never changes backend enablement.
- Verification: Registry completeness/parity/schema tests against production routes and Settings search.
- Blocked by: S6-F2-T1
- Blocks: S6-F2-T3, S6-F2-T5, S6-F2-T6
- Context: settings visibility/search, sidebar routes, Stage 4 feature registry.

### S6-F2-T3 — Persist visibility and migrate existing users safely

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F2
- Outcome: Visibility survives restart/sync windows and existing users retain current UI until they opt in.
- Scope: Schema/version; per-user local preferences; preserve-current migration; optimistic updates; multi-window invalidation; backup/export scope; unknown feature defaults; rollback.
- Out of scope: Applying permission or capability changes.
- Acceptance: Upgrade changes no existing visibility; rerun touches only confirmed IDs; corrupt preferences recover visibly without data loss.
- Verification: Fresh/upgrade/rollback fixtures, two-window conflicts, export/import, corruption, and restart tests.
- Blocked by: S6-F2-T2
- Blocks: S6-F2-T4, S6-F2-T6, S6-F2-T8
- Context: settings persistence, portability registry, product invalidation.

### S6-F2-T4 — Build the first-run tutorial and questionnaire flow

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F2
- Outcome: New users understand the product, answer bounded questions, review visibility, and enter the app without a wall of features.
- Scope: Welcome; product hierarchy; provider setup routing; questions; preset result; exact visibility review/customize; skip; completion; resume after interruption; keyboard/touch/reader behavior.
- Out of scope: Provider credential implementation.
- Acceptance: Interrupted onboarding resumes; skip uses Standard; no feature/data mutation occurs before confirmation; user can reach first project/chat.
- Verification: State-machine/component tests, fresh-profile E2E, restart at each step, accessibility, responsive visual fixtures.
- Blocked by: S6-F1-T2, S6-F1-T3, S6-F2-T1, S6-F2-T3
- Blocks: S6-F2-T7, S6-F2-T8
- Context: existing onboarding router, project selection, provider setup.

### S6-F2-T5 — Create reusable feature explanations and contextual help

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F2
- Outcome: Every major feature has concise on-demand purpose, use, prerequisites, risk, and enable guidance.
- Scope: Versioned content registry; tutorial cards; Settings descriptions; What is this popovers; empty-state links; no-repeat behavior; copy review; help search keywords.
- Out of scope: Full documentation portal or remote content service.
- Acceptance: One source feeds all placements; stale/missing explanations fail tests; popovers do not interrupt experienced users automatically.
- Verification: Registry parity tests, snapshot/copy review, keyboard/touch/reader popover walkthrough.
- Blocked by: S6-F1-T2, S6-F2-T1, S6-F2-T2
- Blocks: S6-F2-T6, S6-F2-T8
- Context: feature registry, Settings search, tooltip/popover primitives.

### S6-F2-T6 — Add Settings visibility controls and rerunnable setup

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F2
- Outcome: Users inspect/toggle every optional surface and rerun setup with a safe preview.
- Scope: Feature Visibility page; grouped controls; prerequisites; individual/bulk preset preview; Run setup guide again; reset; search/deep links; save conflict; multi-window refresh.
- Out of scope: Disabling underlying services or deleting data.
- Acceptance: Hidden features remain listed; rerun previews a diff; prerequisite conflicts explain repair; cancel changes nothing.
- Verification: Settings registry/search/order tests, rerun/apply/cancel, two-window conflict, keyboard/accessibility, restart.
- Blocked by: S6-F1-T5, S6-F2-T2, S6-F2-T3, S6-F2-T5
- Blocks: S6-F2-T7, S6-F2-T8
- Context: alphabetical Settings IA, settings persistence, route visibility.

### S6-F2-T7 — Prove hidden-feature operation and safe discovery

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F2
- Outcome: Hiding UI never disables valid data/API/MCP/background behavior or weakens control.
- Scope: Cross-feature contract tests; direct links; Settings search; MCP/API calls; automation/daemon operation; notifications; prerequisites; re-enable navigation; security invariants.
- Out of scope: Exercising every feature's full acceptance matrix.
- Acceptance: Hidden features keep data and allowed operations; unsafe actions retain approval/audit; no hidden feature becomes unreachable for repair.
- Verification: Parameterized registry integration suite plus live focused walkthrough for representative Plan, automation, usage, and orchestration surfaces.
- Blocked by: S6-F2-T4, S6-F2-T6
- Blocks: S6-F2-T8
- Context: feature registry, app-control MCP, automation, usage daemon.

### S6-F2-T8 — Close onboarding and visibility acceptance

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F2
- Outcome: Fresh, upgraded, focused, standard, complete, skipped, and rerun paths pass on one exact SHA.
- Scope: Matrix S6-ON; migrations; accessibility; explanations; hidden operations; Settings; restart/multi-window; docs; package walkthrough.
- Out of scope: General UI/UX acceptance owned by F1.
- Acceptance: New user reaches first useful chat; existing user changes nothing without consent; all presets are reversible and truthful.
- Verification: Node 22 npm run check, strict OpenSpec, verified Dev fresh/upgrade profiles, accessibility, and packaged preview.
- Blocked by: S6-F2-T3, S6-F2-T4, S6-F2-T5, S6-F2-T6, S6-F2-T7
- Blocks: S6-F11-T2, S6-F11-T5
- Context: docs/stage6-full-feature-test-matrix.md.

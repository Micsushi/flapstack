# S6-F11 — Integrated Stage 6 Release

### S6-F11-T1 — Freeze candidate and reconcile every board/matrix row

- Evidence classes: `T2-core`, `T2-capability:stage6-overlay-inventory`, `release-gate`.
- [x] T2-core completion: acceptance and verification passed
- [ ] Capability evidence: `T2-capability:stage6-overlay-inventory` remains uncertified.
- [ ] Release evidence: `release-gate` remains uncertified for stage6-release-overlay-inventory.
- Parent: Project Flapstack / Stage S6 / Feature S6-F11
- Outcome: One exact candidate ledger maps all F1-F10/F12 tasks and Stage 6 matrix rows to current evidence or explicit blocker.
- Scope: Exact SHA/tree/profile; task/feature counts; matrix crosswalk; evidence freshness; environment/credential/device/platform inventory; defect ledger; freeze/change rules.
- Out of scope: Closing missing evidence by assertion.
- Acceptance: No duplicate/orphan row; stale prior-SHA evidence rejected; all F1-F9 and F12 `T2-core` feature scopes complete before freeze; F10 and every capability/release overlay remain explicit.
- Verification: Automated ledger validator plus independent completeness review.
- Blocked by for T2-core: the `T2-core` scopes of S6-F1-T9, S6-F2-T8, S6-F3-T9, S6-F4-T8, S6-F5-T8, S6-F6-T10, S6-F7-T7, S6-F8-T7, S6-F9-T8, and S6-F12-T9.
- Release certification remains blocked by: S6-F10-T1 through S6-F10-T8 and every release overlay named in the Stage 6 matrix.
- Blocks: S6-F11-T2, S6-F11-T3, S6-F11-T4, S6-F11-T5, S6-F11-T6, S6-F11-T7
- Context: all Stage 6 tasks, docs/stage6-full-feature-test-matrix.md.

### S6-F11-T2 — Prove clean install and Stage 5 upgrade/rollback

- Evidence class: `release-gate`.
- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F11
- Outcome: Fresh users and Stage 5 users reach Stage 6 without data, authority, history, or preference loss.
- Scope: Clean profiles; Stage 5 final DB/config/files; preserved Stage 4 legacy fixture; all migrations; onboarding; preserve-current visibility; inline personality; devices/artifacts/workspaces; interrupted migration; backup/rollback/reopen.
- Out of scope: Unsupported ancient schemas outside declared policy.
- Acceptance: Identity/history unchanged; defaults consent-safe; rollback/recovery documented; failures preserve source.
- Verification: Canonical migration fixtures and native clean/upgrade/package walkthrough on promoted platforms.
- Blocked by: S6-F2-T8, S6-F10-T8, S6-F11-T1
- Blocks: S6-F11-T3, S6-F11-T8
- Context: migration chain, onboarding, portability, package installers.

### S6-F11-T3 — Run one complete Stage 6 project workflow

- Evidence classes: `T2-core`, `T2-capability:providers-mobile-obsidian-capture`.
- [x] T2-core completion: acceptance and verification passed
- [ ] Capability evidence: `T2-capability:providers-mobile-obsidian-capture` remains uncertified.
- Parent: Project Flapstack / Stage S6 / Feature S6-F11
- Outcome: One realistic project uses every Stage 6 user-facing capability together with matching state and recovery.
- T2-core scope: One deterministic project exercises onboarding visibility, profile and personality selection, Reviewer child, structured workflow, grid, visual/usage/mobile/knowledge contracts, restart, artifacts, audit, usage, and export without inventing unavailable external evidence.
- Separate capability evidence: Credentialed providers, real mobile devices, native capture, and real Obsidian interoperability remain independently uncertified.
- Out of scope: Inventing unavailable provider/org/mobile evidence.
- Acceptance: One durable identity per object; exact snapshots/provenance; no duplicate/replay; hidden surfaces remain functional; restart resumes truthfully.
- Verification: Scripted/manual exact-SHA walkthrough with screenshots/logs/DB assertions and forced restart.
- Blocked by for T2-core: the `T2-core` scopes of S6-F3-T9, S6-F4-T8, S6-F5-T8, S6-F6-T10, S6-F7-T7, S6-F8-T7, and S6-F11-T1.
- Release certification remains blocked by: S6-F11-T2 and the named Stage 6 release overlays.
- Blocks: S6-F11-T4, S6-F11-T5, S6-F11-T8
- Context: Stage 6 manual test handoff and candidate ledger.

### S6-F11-T4 — Complete independent security and privacy review

- Evidence classes: `T2-core`, `T2-capability:external-device-provider-attack-paths`, `release-gate`.
- [x] T2-core completion: acceptance and verification passed
- [ ] Capability evidence: `T2-capability:external-device-provider-attack-paths` remains uncertified.
- [ ] Release evidence: `release-gate` remains uncertified for package-supply-chain-review.
- Parent: Project Flapstack / Stage S6 / Feature S6-F11
- Outcome: Local network, capture, profiles/Markdown, credentials, imports, artifacts, packages, and agent controls have no unresolved release-blocking flaw.
- Scope: Threat models; path/symlink; secrets; prompt injection; graph/frontmatter/Wikilink/Obsidian trust; mobile network/pairing/replay; visual redaction; personality trust; organization keys; group controls; package supply chain; audit/redaction.
- Out of scope: Unsupported zero-risk claims.
- Acceptance: P0/P1 and acceptance blockers fixed/retested; known lower findings documented with owner/rationale.
- Verification: Focused security suites, artifact/secret scans, manual attack walkthroughs, independent review report.
- Blocked by for T2-core: the `T2-core` scopes of S6-F4-T8, S6-F5-T8, S6-F7-T7, S6-F8-T7, S6-F11-T1, and S6-F11-T3.
- Release certification remains blocked by: S6-F10-T6, S6-F10-T8, and the package-supply-chain review.
- Blocks: S6-F11-T8
- Context: all Stage 6 threat models and audit services.

### S6-F11-T5 — Complete UI, accessibility, and usability acceptance

- Evidence classes: `T2-core`, `T2-capability:native-assistive-technology-and-device`.
- [x] T2-core completion: acceptance and verification passed
- [ ] Capability evidence: `T2-capability:native-assistive-technology-and-device` remains uncertified.
- Parent: Project Flapstack / Stage S6 / Feature S6-F11
- Outcome: Novice, focused, standard, complete, and power-user paths are understandable and operable across supported input/window/device modes.
- Scope: F1 audit closure; onboarding; Profile Studio; new chat; grid; mobile; visual; knowledge tree/backlinks/graph/list; Settings; keyboard; screen readers; zoom; touch; multi-window; error/recovery; task timing/user feedback.
- Out of scope: Cosmetic changes without a recorded issue.
- Acceptance: No critical accessibility/usability blocker; optional complexity remains discoverable but not forced; docs/help match UI.
- Verification: Automated accessibility/visual tests plus observed novice/power-user/platform/device walkthroughs.
- Blocked by for T2-core: the `T2-core` scopes of S6-F1-T9, S6-F2-T8, S6-F3-T9, S6-F4-T8, S6-F5-T8, S6-F6-T10, S6-F11-T1, and S6-F11-T3.
- Blocks: S6-F11-T8
- Context: root ui-design.md, onboarding explanations, UX audit.

### S6-F11-T6 — Complete performance, platform, package, and soak gates

- Evidence classes: `T2-core`, `T2-capability:24h-soak-sleep-wake-native-host`, `release-gate`.
- [x] T2-core completion: acceptance and verification passed
- [ ] Capability evidence: `T2-capability:24h-soak-sleep-wake-native-host` remains uncertified.
- [ ] Release evidence: `release-gate` remains uncertified for signing-package-platform-lifecycle.
- Parent: Project Flapstack / Stage S6 / Feature S6-F11
- Outcome: Exact candidate meets core budgets and deterministic lifecycle evidence; native-host and artifact certification remain separate.
- T2-core scope: Full Node gate; reviewed benchmarks; graph index/layout/watcher scale; deterministic services/daemons/bridge/helper lifecycle; shutdown and cleanup.
- Separate certification: 24-hour soak, sleep/wake, promoted native platforms, signing/notarization, package install/upgrade/uninstall, and artifact inspection.
- Out of scope: Cross-build substitution.
- T2-core acceptance: All 46 required core budgets pass with zero omissions; no owned process, listener, service, watcher, or ABI mutation survives cleanup.
- Verification: S6 performance/platform reports and independent package inspection.
- Blocked by for T2-core: the `T2-core` scopes of S6-F6-T10, S6-F7-T6, S6-F8-T7, S6-F9-T8, and S6-F11-T1.
- Release certification remains blocked by: S6-F10-T8 and the named capability/release overlays.
- Blocks: S6-F11-T8
- Context: performance report, platform matrix, package manifests.

### S6-F11-T7 — Reconcile product, installation, support, and recovery documentation

- Evidence classes: `T2-core`, `release-gate`.
- [x] T2-core completion: acceptance and verification passed
- [ ] Release evidence: `release-gate` remains uncertified for installation-artifact-support-recovery-docs.
- Parent: Project Flapstack / Stage S6 / Feature S6-F11
- Outcome: README, UI help, tutorials, specs, matrices, support limits, and recovery guides describe the same released product.
- Scope: Stage status; feature list; onboarding/help copy; profiles/personality terminology; mobile/network; visual privacy; Obsidian/knowledge graph/Git/context limits; usage provenance; performance limits; platform install/recovery; diagnostics; known issues; no stale future claims.
- Out of scope: Marketing site.
- Acceptance: Links/commands/paths/version claims verified; no task/spec/doc conflict; unsupported evidence not claimed.
- Verification: Docs/link/command scanners, manual crosswalk, support-bundle secret scan.
- Blocked by for T2-core: the `T2-core` scope of S6-F11-T1.
- Release certification remains blocked by: S6-F10-T7 and S6-F10-T8.
- Blocks: S6-F11-T8
- Context: README, ui-design.md, OpenSpec, Stage 6 docs.

### S6-F11-T8 — Run review/fix rounds and record release decision

- Evidence class: `T2-core`.
- [x] T2-core completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F11
- Outcome: Independent correctness, security, and UI reviews leave no unresolved Tier 2 blocker, and one exact candidate has a truthful handoff for separately authorized release evaluation.
- Scope: Up to three bounded review/fix rounds; defect severity; rerun affected/full core gates; final ledger; limitations; rollback; manual handoff; Tier 2 acceptance decision.
- Out of scope: Merge, push, tag, publish, or archive without separate explicit authority.
- Acceptance: Required rows green; no P0/P1/acceptance blocker; every limitation/credential/device/platform gap explicit; final SHA immutable in handoff.
- Verification: Independent review reports, final Node/OpenSpec/matrix validators, exact-SHA handoff audit.
- Blocked by for T2-core: the `T2-core` scopes of S6-F11-T3 through S6-F11-T7.
- Separate release decision: Publication readiness remains blocked by S6-F11-T2 and every named release overlay.
- Blocks: Stage S6 exit
- Context: candidate ledger, defect log, docs/stage6-full-feature-test-matrix.md.

# Stage 6 Execution Plan

Stage 6 begins after one exact Stage 5 source state has all 50
implementation-gating task checkboxes and all 40 `T2-core` matrix rows
accepted. That Stage 5 baseline already inherits accepted Stage 4 behavior.
Uncertified provider/device capabilities and distributable-release gates remain
visible constraints, but they do not block Stage 6 entry.

## Outcome

Deliver an approachable, polished, personalized, cross-device, performant, and
cross-platform Flapstack release with an Obsidian-compatible project knowledge
graph, without duplicating Stage 4 services or hiding unsupported evidence.

## Acceptance authority

Stage 6 has 86 independently classifiable matrix rows:

- 60 `[T2-core]` rows are implementation-gating and must pass against one exact
  source candidate before Stage 6 Tier 2 can close.
- 10 `[capability-evidence]` rows require optional live providers, devices,
  native assistive technology, Obsidian, capture APIs, or long host observation.
- 16 `[release-evidence]` rows require promoted native distribution artifacts,
  signing credentials, hosted CI, or release review.

Capability and release rows stay visible and open when their prerequisites are
unavailable. They do not become core failures and cannot be checked from fixture
or cross-build evidence. The detailed owner-only journey lives in
`docs/owner-manual-testing-backlog.md`; Tier 3 never blocks Tier 2 completion.

## Current entry state

- Stage 5 source baseline:
  `e2f786f36be5108931f20014f8859e27386431e2`.
- Stage 5 authority is reconciled at 50/50 implementation-gating tasks and
  40/40 `T2-core` matrix rows.
- The 25 still-open Stage 5 task rows are capability or distributable-release
  certification and remain explicit constraints.
- Preserved mobile work is an implementation reference only. Stage 6 ports it
  by reviewed tree equivalence rather than merging unrelated branch history.

## Dependency waves

### Wave 0 — Entry and evidence baseline

- Prove the exact accepted Stage 5 source, schema, 50-task core gate, and
  40-row `T2-core` matrix.
- Import open Stage 5 capability and release certifications as explicit
  constraints for the Stage 6 features that consume them.
- Freeze the Stage 6 task/spec/router crosswalk.
- Inventory the preserved mobile branch by tree equivalence; never blindly merge it.

### Wave 1 — Foundations

- S6-F1 T1-T2: UI audit and shared interaction/design primitives.
- S6-F7 T1: Runtime/orchestration ownership, exact execution-target, and
  harness/Runtime compatibility contract.
- S6-F8 T1: organization API/credential/provenance decision.
- S6-F9 T1-T2: performance budgets and harness.
- S6-F10 T1: platform/release matrix and credential/host inventory.
- S6-F12 T1-T4: seed-note migration, Git-safe Obsidian opening, Markdown
  compatibility contract, and rebuildable graph index/watcher.

### Wave 2 — Vertical feature implementation

- S6-F1 remaining UI/UX surfaces, including dynamic speech vocabulary.
- S6-F2 onboarding, feature registry, explanations, and visibility.
- S6-F3 reusable personalities and universal Agent Profile selection.
- S6-F4 bridge/pairing/events before PWA/actions.
- S6-F5 in-app capture before standalone helper.
- S6-F6 full top-level Chat pane extraction and bounded group tree, then
  directional tab drag/bindings, the main-process four-workbench-window budget,
  floating-window transfer/restoration, and finally fleet/group controls.
- S6-F7 exact target resolution, native authority, bidirectional
  Codex/Claude continuation and delegation, bounded task/result envelopes,
  authority/worktree controls, activity/usage, and no-replay recovery.
- S6-F8 adapters, reconciliation, and dashboard.
- S6-F9 optimizations after measurement.
- S6-F10 native packaging lanes as hosts/credentials become available.
- S6-F12 custom notes, attachments, graph/backlinks, agent context, and
  portability/recovery after its storage/index foundation.

### Wave 3 — Cross-feature composition

- F7 target preview, child-Chat lineage, Runtime controls/activity, and
  cross-provider result contracts unblock F3 profiles, F4 mobile, and F6 swarm.
- F1 UI primitives and Settings IA unblock F2/F3 UI closeout.
- F9 budgets cover F1-F8 workloads.
- F10 native hosts close F5 capture/helper and F7 Runtime platform proof.
- F1 primitives unblock F12 graph UI; F9 budgets and F10 native packages close
  F12 scale and real Obsidian interoperability evidence.

### Wave 4 — Feature exits

- Each feature closes its authoritative OpenSpec board and matching Stage 6 matrix rows.
- Headless tests never substitute for required UI, provider, device, package, or platform evidence.
- Every live claim records exact SHA, checkout, profile, versions, credentials class, OS, and device.

### Wave 5 — S6-F11 integrated release

- Freeze one candidate only after F1-F10 and F12 exit.
- Run clean install and Stage 5 upgrade/rollback, plus preserved Stage 4 legacy migration fixtures.
- Exercise all Stage 6 features in one project.
- Run security/privacy, UI/accessibility/usability, performance, platform/package,
  documentation, and up to three review/fix rounds.
- Produce an exact-SHA handoff. Merge, push, tag, publication, and archive remain
  separate explicitly authorized actions.

## Integration rules

- One feature owns each schema/service/surface change; shared seams use typed ports.
- Preserve user changes and concurrent Stage 5 work; never reset unrelated state.
- Agent Profile remains the only complete named agent configuration. Personality
  is reusable presentation; preset is used only for onboarding visibility.
- Mobile, visual helper, and swarm UI reuse existing local authority and data.
- Native Runtime compatibility is not universal: Codex never uses the Claude
  Code Runtime and Claude Code never uses the Codex Runtime. Cross-provider work
  creates a distinct child Chat/native session through explicit `Continue with`
  or `Delegate to` composition.
- Cross-provider context contains only previewed visible history and selected
  artifact references. Credentials, private/encrypted reasoning, provider
  session state, hidden tool state, and unselected files never cross the boundary.
- Child permissions, descendants, budgets, account, workspace, and worktree are
  resolved explicitly and cannot exceed the initiator's delegation ceiling.
- Provider usage remains attributed to the actual child target and is aggregated
  by reference without double counting.
- The knowledge graph derives from Markdown. SQLite graph/search state is
  rebuildable and never becomes a second knowledge source of truth.
- App-managed knowledge remains outside Git. Project-owned untracked knowledge
  requires a verified local Git exclusion; Flapstack never stages or commits it.
- No hosted relay, hosted sync, hidden telemetry, arbitrary remote command, or
  unlimited/hidden agent spawning enters Stage 6.
- Task checkboxes live only in each OpenSpec tasks.md.

## Verification commands

- Node 22 npm run check.
- Strict validation for every Stage 6 OpenSpec change.
- npm run dev followed by npm run dev:verify for live desktop evidence.
- Platform/package commands defined by S6-F10; macOS public artifacts require
  signing/notarization/staple evidence.
- Real Obsidian round trips cover central and project-owned vaults, external
  edits/renames/links/attachments/conflicts, restart, and package profiles.
- docs/stage6-full-feature-test-matrix.md is the integrated acceptance authority.

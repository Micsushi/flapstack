# Stage 5 Execution Plan

Stage 5 begins only after one exact Stage 4 SHA has all eleven feature boards
and the integrated Stage 4 matrix fully accepted. Stage 5 planning does not
change the active Stage 4 stabilization goal.

## Outcome

Deliver an approachable, polished, personalized, cross-device, performant, and
cross-platform Flapstack release with an Obsidian-compatible project knowledge
graph, without duplicating Stage 4 services or hiding unsupported evidence.

## Dependency waves

### Wave 0 — Entry and evidence baseline

- Prove the exact accepted Stage 4 source, schema, packages, and support matrix.
- Freeze the Stage 5 task/spec/router crosswalk.
- Inventory the preserved mobile branch by tree equivalence; never blindly merge it.

### Wave 1 — Foundations

- S5-F1 T1-T2: UI audit and shared interaction/design primitives.
- S5-F7 T1: Runtime/orchestration ownership contract.
- S5-F8 T1: organization API/credential/provenance decision.
- S5-F9 T1-T2: performance budgets and harness.
- S5-F10 T1: platform/release matrix and credential/host inventory.
- S5-F12 T1-T4: seed-note migration, Git-safe Obsidian opening, Markdown
  compatibility contract, and rebuildable graph index/watcher.

### Wave 2 — Vertical feature implementation

- S5-F1 remaining UI/UX surfaces, including dynamic speech vocabulary.
- S5-F2 onboarding, feature registry, explanations, and visibility.
- S5-F3 reusable personalities and universal Agent Profile selection.
- S5-F4 bridge/pairing/events before PWA/actions.
- S5-F5 in-app capture before standalone helper.
- S5-F6 grid layout/bindings before group controls.
- S5-F7 Runtime composition and recovery.
- S5-F8 adapters, reconciliation, and dashboard.
- S5-F9 optimizations after measurement.
- S5-F10 native packaging lanes as hosts/credentials become available.
- S5-F12 custom notes, attachments, graph/backlinks, agent context, and
  portability/recovery after its storage/index foundation.

### Wave 3 — Cross-feature composition

- F7 Runtime controls/activity unblock F4 mobile and F6 swarm controls.
- F1 UI primitives and Settings IA unblock F2/F3 UI closeout.
- F9 budgets cover F1-F8 workloads.
- F10 native hosts close F5 capture/helper and F7 Runtime platform proof.
- F1 primitives unblock F12 graph UI; F9 budgets and F10 native packages close
  F12 scale and real Obsidian interoperability evidence.

### Wave 4 — Feature exits

- Each feature closes its authoritative OpenSpec board and matching Stage 5 matrix rows.
- Headless tests never substitute for required UI, provider, device, package, or platform evidence.
- Every live claim records exact SHA, checkout, profile, versions, credentials class, OS, and device.

### Wave 5 — S5-F11 integrated release

- Freeze one candidate only after F1-F10 and F12 exit.
- Run clean install and Stage 4 upgrade/rollback.
- Exercise all Stage 5 features in one project.
- Run security/privacy, UI/accessibility/usability, performance, platform/package,
  documentation, and up to three review/fix rounds.
- Produce an exact-SHA handoff. Merge, push, tag, publication, and archive remain
  separate explicitly authorized actions.

## Integration rules

- One feature owns each schema/service/surface change; shared seams use typed ports.
- Preserve user changes and concurrent Stage 4 work; never reset unrelated state.
- Agent Profile remains the only complete named agent configuration. Personality
  is reusable presentation; preset is used only for onboarding visibility.
- Mobile, visual helper, and swarm UI reuse existing local authority and data.
- The knowledge graph derives from Markdown. SQLite graph/search state is
  rebuildable and never becomes a second knowledge source of truth.
- App-managed knowledge remains outside Git. Project-owned untracked knowledge
  requires a verified local Git exclusion; Flapstack never stages or commits it.
- No hosted relay, hosted sync, hidden telemetry, arbitrary remote command, or
  unlimited/hidden agent spawning enters Stage 5.
- Task checkboxes live only in each OpenSpec tasks.md.

## Verification commands

- Node 22 npm run check.
- Strict validation for every Stage 5 OpenSpec change.
- npm run dev followed by npm run dev:verify for live desktop evidence.
- Platform/package commands defined by S5-F10; macOS public artifacts require
  signing/notarization/staple evidence.
- Real Obsidian round trips cover central and project-owned vaults, external
  edits/renames/links/attachments/conflicts, restart, and package profiles.
- docs/stage5-full-feature-test-matrix.md is the integrated acceptance authority.

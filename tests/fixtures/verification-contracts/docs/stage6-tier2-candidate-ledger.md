# Stage 6 Tier 2 Candidate Ledger

Status update 2026-08-05: the final Stage 6 core gate completed and all 60
`T2-core` rows remain accepted. This ledger is now the historical evidence map
for that decision. The 10 capability and 16 release overlays listed below stay
open and must not be inferred from core acceptance.

This ledger maps every Stage 6 `[T2-core]` acceptance row to its implementation
evidence and required independent review lane. OpenSpec task boards split their
core completion from capability and release certification. Checked core task
and matrix rows were candidate claims until the final exact-candidate run
succeeded. Capability and distribution-release evidence remains open and
nonblocking for Tier 2.

The mechanical ledger gate requires this map to cover 60/60 `T2-core` matrix rows.

## Candidate resolution

The candidate SHA is the clean commit that contains this ledger, the reconciled
matrix, and all Stage 6 implementation changes. Resolve it only from that
checkout when the final gates run:

```powershell
git status --short
git rev-parse HEAD
```

Acceptance requires an empty `git status --short` result. Every external report
under `.local-evidence` must record the exact `git rev-parse HEAD` value observed
when the report is produced. A dirty-tree SHA, an earlier source SHA, or a SHA
written into this ledger before the containing commit exists is not an accepted
candidate. This tracked ledger intentionally does not embed its own candidate
SHA. If any required final gate fails, that SHA is not accepted and the affected
candidate claims must be revised before another candidate is frozen.

## Evidence batches

These are historical results reported during Stage 6 implementation and review.
They remain useful diagnostics, but none independently establishes final
exact-candidate acceptance. `E-FINAL` means the external final reports for the
Node, OpenSpec, independent review, Electron, performance, and integrated lanes
all record and pass against the same clean candidate SHA.

- **E-OS:** strict OpenSpec validation reported 26/26 active changes valid.
- **E-CHECK:** preliminary Node 22 `npm run check` reported 376 passing test
  files, 3 skipped files, 3,065 passing tests, and 33 skipped tests, followed by
  a successful production build. It predates the final candidate.
- **E-SEC:** focused security/privacy repair batch reported 10 files passing,
  100 tests passing, and 1 skipped test.
- **E-UI:** focused UI/accessibility repair batch reported 9 files and 35 tests
  passing.
- **E-WB:** focused Chat workbench suites were reported green.
- **E-PF03:** independent PF03 production-seam rereview reported 4 files and 66
  tests passing, plus TypeScript, scoped ESLint, Prettier, and diff checks.
- **E-EL:** the exact development app previously passed `npm run dev:verify`
  twice.

## Task-board reconciliation

The twelve Stage 6 OpenSpec boards contain 100 unique task records. Fifty are
pure `T2-core` tasks, 41 split a checked core scope from open overlays, and the
eight S6-F10 distribution tasks plus S6-F11-T2 are `release-gate` records that
remain open. Mixed tasks keep their capability and release evidence as separate
unchecked rows, so unavailable providers, devices, native hosts, long soaks,
signing, and packages cannot be mistaken for core completion or silently
certified.

The mechanical ledger validator enforces these counts, evidence classes,
checkbox states, and unique task identities together with the 60-row matrix map.

## Core row map

Each row names the implementation evidence and final review lane. Its checked
matrix state is accepted only through the same-SHA `E-FINAL` result; this
tracked map does not claim that result in advance.

### Automated, UI, and onboarding

| Core ID | Implementation and evidence suites                                                                                                                                                                                                            | Required final review lane                                                                    |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| S6-A01  | All active OpenSpec changes; `@fission-ai/openspec validate --changes --strict --no-interactive`                                                                                                                                              | Documentation/spec lane. Final disposition is bound by the same-SHA `E-FINAL` report.         |
| S6-A02  | Repository-wide Node 22 check and production build                                                                                                                                                                                            | Integrated gate. Final disposition is bound by the same-SHA `E-FINAL` report.                 |
| S6-A03  | Migration and recovery coverage in `agent-activity-migration`, `agent-runtime-migration`, `chat-mode-migration`, `coordination-engine-migration`, `credential-migration`, `stage3-migration-rebase`, and portability durability/import suites | Data-integrity lane. Final disposition is bound by the same-SHA `E-FINAL` report.             |
| S6-A04  | Path, secret, profile/Markdown, mobile, visual, organization, graph, group-control, and package-security suites                                                                                                                               | Security/privacy lane. Final disposition is bound by the same-SHA `E-FINAL` report.           |
| S6-A05  | UI/accessibility suites, Stage 6 performance suites, this ledger, and matrix/evidence validators                                                                                                                                              | Cross-gate lane. Final disposition is bound by the same-SHA `E-FINAL` report.                 |
| S6-UX01 | `stage6-f1-f2-renderer-contract`, navigation, Settings search, workspace ownership, and UI-lock suites                                                                                                                                        | UI/accessibility lane. Final disposition is bound by the same-SHA `E-FINAL` report.           |
| S6-UX02 | Active Chat, composer, transcript overview, attachment tray, and recovery contracts                                                                                                                                                           | UI/usability lane. Final disposition is bound by the same-SHA `E-FINAL` report.               |
| S6-UX03 | `settings-search`, Settings target/visibility, and Stage 6 renderer contracts                                                                                                                                                                 | UI/accessibility lane. Final disposition is bound by the same-SHA `E-FINAL` report.           |
| S6-UX04 | Transcript overview, saved-workspace ownership, workbench session/persistence, and responsive projection suites                                                                                                                               | UI/workbench lane. Final disposition is bound by the same-SHA `E-FINAL` report.               |
| S6-UX05 | `stage6-ui-review-fixes`, `speech-vocabulary`, accessibility, responsive, and renderer-contract suites                                                                                                                                        | UI/accessibility/usability lane. Final disposition is bound by the same-SHA `E-FINAL` report. |
| S6-ON01 | `onboarding-visibility-state` and `stage6-f1-f2-renderer-contract`                                                                                                                                                                            | UI/state lane. Final disposition is bound by the same-SHA `E-FINAL` report.                   |
| S6-ON02 | Existing-user visibility migration/state coverage in onboarding and feature-visibility suites                                                                                                                                                 | Upgrade/state lane. Final disposition is bound by the same-SHA `E-FINAL` report.              |
| S6-ON03 | `feature-visibility-registry`, `feature-visibility-store`, `feature-visibility-router`, and renderer contracts                                                                                                                                | Security/UI lane. Final disposition is bound by the same-SHA `E-FINAL` report.                |
| S6-ON04 | Onboarding explanations, Settings visibility, and renderer-contract suites                                                                                                                                                                    | UI/content lane. Final disposition is bound by the same-SHA `E-FINAL` report.                 |

### Profiles, mobile, and visual context

| Core ID | Implementation and evidence suites                                                                   | Required final review lane                                                                 |
| ------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| S6-AP01 | `agent-profiles`, `agent-profile-runtime-authority`, personality store, and renderer contracts       | Architecture/security lane. Final disposition is bound by the same-SHA `E-FINAL` report.   |
| S6-AP02 | `agent-personalities`, `agent-personality-store`, and `agent-personality-watcher`                    | Data-integrity/security lane. Final disposition is bound by the same-SHA `E-FINAL` report. |
| S6-AP03 | `agent-profile-chat-binding`, profile chat renderer, and new-chat selection contracts                | UI/runtime lane. Final disposition is bound by the same-SHA `E-FINAL` report.              |
| S6-AP04 | Profile runtime authority, workflow binding, orchestration, retry, and continuation suites           | Runtime/security lane. Final disposition is bound by the same-SHA `E-FINAL` report.        |
| S6-AP05 | `agent-profile-speed`, profile import/evaluation/Studio, renderer, and accessibility contracts       | UI/runtime lane. Final disposition is bound by the same-SHA `E-FINAL` report.              |
| S6-MC01 | `mobile-bridge`, network fixtures, mobile pairing HTTP, and hosted-telemetry safety suites           | Security/privacy lane. Final disposition is bound by the same-SHA `E-FINAL` report.        |
| S6-MC02 | `mobile-pairing`, `mobile-pairing-http`, and bridge identity/session suites                          | Security lane. Final disposition is bound by the same-SHA `E-FINAL` report.                |
| S6-MC03 | `mobile-events`, bridge snapshots, replay, pruning, and sequencing suites                            | Security/data-integrity lane. Final disposition is bound by the same-SHA `E-FINAL` report. |
| S6-MC04 | `mobile-actions-contract`, `mobile-companion-ui`, shared-service, and notification/offline contracts | UI/service lane. Final disposition is bound by the same-SHA `E-FINAL` report.              |
| S6-VC01 | Capture session, Electron provider, pending-store, and lifecycle contracts                           | Security/UI lane. Final disposition is bound by the same-SHA `E-FINAL` report.             |
| S6-VC02 | `visual-capture-derivative`, artifact store, redaction, and confirmed-hash suites                    | Security/data-integrity lane. Final disposition is bound by the same-SHA `E-FINAL` report. |
| S6-VC03 | Run provenance, runtime integration, attachment, and selected-context suites                         | Security/runtime lane. Final disposition is bound by the same-SHA `E-FINAL` report.        |
| S6-VC04 | Agent tool, helper equivalence, lifecycle, retention, tamper, and missing-artifact suites            | Security/architecture lane. Final disposition is bound by the same-SHA `E-FINAL` report.   |

### Chat workbench and Runtime composition

| Core ID | Implementation and evidence suites                                                                                              | Required final review lane                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| S6-TG01 | `stage6-chat-pane-isolation`, workbench component/reducer/session, and simultaneous-send contracts                              | Workbench/UI lane. Final disposition is bound by the same-SHA `E-FINAL` report.             |
| S6-TG02 | Workbench reducer/component, layout preset, split, drag/drop, and keyboard contracts                                            | Workbench/UI lane. Final disposition is bound by the same-SHA `E-FINAL` report.             |
| S6-TG03 | `chat-window-transfer`, window ownership, session sync, and transfer-coordinator contracts                                      | Workbench/ownership lane. Final disposition is bound by the same-SHA `E-FINAL` report.      |
| S6-TG04 | `workbench-window-budget`, ownership, and concurrent creation-path contracts                                                    | Workbench/main-process lane. Final disposition is bound by the same-SHA `E-FINAL` report.   |
| S6-TG05 | Workbench storage/session, Stage 6 persistence controls, saved-workspace adapter, and restore contracts                         | Workbench/data-integrity lane. Final disposition is bound by the same-SHA `E-FINAL` report. |
| S6-TG06 | `stage6-f6-projections`, orchestration fleet/lineage/activity, and pane identity contracts                                      | Workbench/runtime lane. Final disposition is bound by the same-SHA `E-FINAL` report.        |
| S6-TG07 | Swarm group-control panel/router, selection preview, partial-result, accessibility, and performance contracts                   | Workbench/security/UI lane. Final disposition is bound by the same-SHA `E-FINAL` report.    |
| S6-RO01 | Runtime resolver, registry, compatibility, launch integration, selector, and composition contracts                              | Runtime/security lane. Final disposition is bound by the same-SHA `E-FINAL` report.         |
| S6-RO02 | Flapstack native adapter, provider-router guard, Runtime registry, activity, and composition contracts                          | Runtime architecture lane. Final disposition is bound by the same-SHA `E-FINAL` report.     |
| S6-RO03 | Runtime continuation, renderer continuation, context-manifest, and cross-provider delegation suites                             | Runtime/security lane. Final disposition is bound by the same-SHA `E-FINAL` report.         |
| S6-RO04 | `cross-provider-delegation`, composition contracts, delegation renderer, orchestration operations, and structured-result suites | Runtime/security lane. Final disposition is bound by the same-SHA `E-FINAL` report.         |
| S6-RO05 | Cross-provider secret barriers, Runtime sanitizer, portability secrets, usage secrets, and export/redaction suites              | Security/privacy lane. Final disposition is bound by the same-SHA `E-FINAL` report.         |
| S6-RO06 | Delegation capability lattice, approvals, orchestration controls, workspace/worktree, and group partial-result suites           | Security/runtime lane. Final disposition is bound by the same-SHA `E-FINAL` report.         |
| S6-RO07 | Runtime activity ordering/export, usage attribution, cancellation/recovery, provider recovery, and composition suites           | Runtime/data-integrity lane. Final disposition is bound by the same-SHA `E-FINAL` report.   |

### Usage, knowledge graph, and performance

| Core ID | Implementation and evidence suites                                                                              | Required final review lane                                                                    |
| ------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| S6-OU01 | `organization-usage-stage6`, auth-store security, usage secrets, and credential migration suites                | Security/privacy lane. Final disposition is bound by the same-SHA `E-FINAL` report.           |
| S6-OU02 | Organization usage pagination, rate/freshness, provenance, and usage provider suites                            | Data-integrity lane. Final disposition is bound by the same-SHA `E-FINAL` report.             |
| S6-OU03 | Organization usage, usage attribution/rollups/store/dashboard/budgets suites                                    | Usage/data-integrity lane. Final disposition is bound by the same-SHA `E-FINAL` report.       |
| S6-OU04 | Organization usage, usage daemon lifecycle/maintenance, revoke/failure, and sanitized evidence suites           | Security/lifecycle lane. Final disposition is bound by the same-SHA `E-FINAL` report.         |
| S6-KG01 | `project-vault-seed-identity`, storage, policy, migration, and portability suites                               | Data-integrity/security lane. Final disposition is bound by the same-SHA `E-FINAL` report.    |
| S6-KG02 | `project-vault-custom-notes`, attachment MIME/path safety, frontmatter, and Obsidian parser suites              | Security/data-integrity lane. Final disposition is bound by the same-SHA `E-FINAL` report.    |
| S6-KG03 | `project-vault-graph-index`, Obsidian note parser, backlink, alias, and unresolved-link suites                  | Graph/data-integrity lane. Final disposition is bound by the same-SHA `E-FINAL` report.       |
| S6-KG04 | `project-vault-graph-surface`, custom-note surface, navigation, pending context, and Stage 6 UI fixes           | UI/accessibility lane. Final disposition is bound by the same-SHA `E-FINAL` report.           |
| S6-KG06 | `project-vault-git-exclusion`, policy, storage, and MCP project-vault operations                                | Security/Git-safety lane. Final disposition is bound by the same-SHA `E-FINAL` report.        |
| S6-KG07 | `project-vault-graph-context`, pending context, run context, path safety, and MCP operations                    | Security/runtime lane. Final disposition is bound by the same-SHA `E-FINAL` report.           |
| S6-KG08 | Graph index rebuild/watchers, portability/remapping, IO durability, corruption/recovery, and performance suites | Data-integrity/performance lane. Final disposition is bound by the same-SHA `E-FINAL` report. |
| S6-PF01 | Performance authority, harness, report integrity, candidate binding, portability, and CLI suites                | Performance/documentation lane. Final disposition is bound by the same-SHA `E-FINAL` report.  |
| S6-PF02 | Performance core/harness plus repaired Electron test-control and live adapter                                   | Performance/Electron lane. Final disposition is bound by the same-SHA `E-FINAL` report.       |
| S6-PF03 | `stage6-performance-production-paths`, core, harness, and portability suites                                    | Performance/resource lane. Final disposition is bound by the same-SHA `E-FINAL` report.       |
| S6-PF04 | Performance core, CLI, platform support, `scripts/check.mjs`, and support-limit contracts                       | Performance/integration lane. Final disposition is bound by the same-SHA `E-FINAL` report.    |

### Integrated release

| Core ID | Implementation and evidence suites                                                                                                                              | Required final review lane                                                                |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| S6-I01  | This ledger plus `npm run check:stage6-tier2-ledger`, which compares all matrix `[T2-core]` IDs exactly once                                                    | Documentation/evidence lane. Final disposition is bound by the same-SHA `E-FINAL` report. |
| S6-I03  | Repository-wide integration suites spanning onboarding, profiles, Runtime composition, workbench, visual, mobile, usage, graph, restart, audit, and portability | Integrated lane. Final disposition is bound by the same-SHA `E-FINAL` report.             |
| S6-I04  | Independent security/privacy, UI/accessibility/usability, performance, workbench, Electron, and documentation reviews                                           | Independent review lane. Final disposition is bound by the same-SHA `E-FINAL` report.     |
| S6-I05  | Final review/fix accounting, exact-candidate gates, clean handoff, and external evidence set                                                                    | Integrated release lane. Final disposition is bound by the same-SHA `E-FINAL` report.     |

## Open nonblocking overlays

The following rows remain open. They are not substitutes for core evidence and
do not block Stage 6 Tier 2 while their external prerequisites are unavailable.

### Capability evidence: 10 rows

`S6-UX05C`, `S6-AP05C`, `S6-MC05`, `S6-VC01C`, `S6-TG07C`,
`S6-RO08`, `S6-OU04C`, `S6-KG05`, `S6-PF03C`, `S6-I03C`

### Release evidence: 16 rows

`S6-A03R`, `S6-AP05R`, `S6-MC05R`, `S6-VC04R`, `S6-TG07R`,
`S6-RO08R`, `S6-OU04R`, `S6-KG08R`, `S6-PF04R`, `S6-PD01`,
`S6-PD02`, `S6-PD03`, `S6-PD04`, `S6-PD05`, `S6-I02`, `S6-I04R`

## Final exact-candidate gates

Tier 2 acceptance is bound only when the final run:

- resolves a clean candidate with `git status --short` and `git rev-parse HEAD`;
- passes Node 22 `npm run check` and strict OpenSpec validation on that SHA;
- completes the independent workbench, UI, Electron, and documentation reviews
  without P0/P1 or acceptance blockers;
- passes the full reviewed Stage 6 performance acceptance command, including
  the repaired live Electron observer, on that SHA; and
- binds the integrated deterministic project and every required external
  `.local-evidence` report to that same SHA.

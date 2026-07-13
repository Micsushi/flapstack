# Stage 3 release candidate ledger

Status: safe closeout in progress. This ledger does not claim Stage 3 release
completion while required live, UI, credential, or platform rows remain open.

## Candidate header

- Candidate source: the exact commit containing this ledger, resolved with
  `git rev-parse HEAD` and recorded in the final handoff after commit.
- Integration baseline: `fba7e32bec5db21233d17b82a8745e974de90293`.
- Checkout: isolated `cf53` worktree on
  `codex/s3-f17-release-closeout-cf53`; the main worktree is read-only.
- Profile isolation: `Flapstack Dev cf53` for development and
  `Flapstack Preview` for the unsigned macOS package.
- Supported release runtime: Node 22. macOS arm64 is locally available;
  Windows and Linux are unavailable in this lane.
- Result vocabulary: only PASS satisfies a required row. FAIL, BLOCKED, and
  NOT RUN remain release-open.

Any code, test, spec, or release-document change advances the candidate. The
affected rows and full automated gate rerun on the new commit. Evidence from a
different SHA is context only.

## Stable release rows

| Row family                                          | Scope                                                                      | Evidence source                      |
| --------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------ |
| `S3-P01`-`S3-P06`                                   | identity, full gate, strict validation, migrations, dev identity, packages | this ledger and full-feature matrix  |
| `S3-M01`-`S3-M07`, `M-01`-`M-20`                    | production MCP, approvals, audit, spawn, restart                           | headless integration audit           |
| `S3-S01`-`S3-S07`                                   | Settings, credentials, extensions, permissions, copy/search                | full-feature and credential matrices |
| `S3-V01`-`S3-V02`                                   | Voice automation and manual macOS/Windows behavior                         | Voice matrix                         |
| `S3-U01`, `U1-01`-`U11-05`                          | Usage, daemon, provider, alert, dashboard                                  | Usage exit matrix                    |
| `S3-H01`, `D0-01`-`D5-02`, `E1-01`-`E7-03`          | Cursor, OpenRouter, NanoGPT                                                | provider closeout matrix             |
| `S3-R01`, `R-FIXTURE`, `R-LIVE`, `R-UI`, `R-RELOAD` | reasoning classification, controls, persistence, live providers            | reasoning capability matrix          |
| `S3-C01`, `S3-A01`-`S3-A07`                         | Stage 1/2 carryover and supporting active changes                          | full gate plus focused live rows     |
| `S3-X01`-`S3-X06`                                   | integrated walkthrough, review, docs, cleanup                              | this ledger and full-feature matrix  |

## Active normative-scenario crosswalk

Every normative scenario under a mapped active change is owned by the named
stable row family. `npm run check:stage3-release-ledger` enumerates every
non-archive change and scenario and fails when a mapping disappears.

<!-- stage3-release-change: add-agent-change-undo-review | rows=S3-A01,S3-A02,S3-X01 -->
<!-- stage3-release-change: add-agent-question-dialog | rows=S3-A03,S3-X01 -->
<!-- stage3-release-change: add-chat-header-open-in | rows=S3-A04,S3-X01 -->
<!-- stage3-release-change: add-copy-chat-history | rows=S3-S07,S3-A05,S3-X01 -->
<!-- stage3-release-change: add-dev-test-control-mcp | rows=S3-M06,S3-A06,S3-P06 -->
<!-- stage3-release-change: add-message-timestamps | rows=S3-A07,S3-X01 -->
<!-- stage3-release-change: add-model-tuning-dropdown | rows=S3-R01,R-FIXTURE,R-UI -->
<!-- stage3-release-change: add-stage2-voice-usage-cursor | rows=S3-V01,S3-U01,S3-H01,S3-R01 -->
<!-- stage3-release-change: add-stage3-mcp-control | rows=S3-M01,S3-M02,S3-M03,S3-M04,S3-M05,S3-M06,S3-M07 -->
<!-- stage3-release-change: close-provider-harnesses | rows=S3-H01,D0-01,D5-02,E1-01,E7-03 -->
<!-- stage3-release-change: complete-settings-reliability | rows=S3-S01,S3-S02,S3-S03,S3-S04,S3-S05,S3-S06,S3-S07,S3-V01,S3-V02 -->
<!-- stage3-release-change: harden-usage-exit | rows=S3-U01,U1-01,U11-05 -->
<!-- stage3-release-change: improve-agent-context-and-evidence | rows=S3-A01,S3-A06,S3-X01 -->
<!-- stage3-release-change: prove-reasoning-parity | rows=S3-R01,R-FIXTURE,R-LIVE,R-UI,R-RELOAD -->
<!-- stage3-release-change: remove-visible-sub-chats | rows=S3-C01,S3-A05,S3-X01 -->
<!-- stage3-release-change: stabilize-stage3-foundation | rows=S3-P02,S3-P04 -->
<!-- stage3-release-change: sync-provider-permissions-globally | rows=S3-S06,S3-M03,S3-X02 -->
<!-- stage3-release-change: validate-stage3-release | rows=S3-P01,S3-P02,S3-P03,S3-P04,S3-P05,S3-P06,S3-X01,S3-X02,S3-X03,S3-X04,S3-X05,S3-X06 -->

## Feature-exit dependency graph

The machine-readable entries define the acyclic graph. The checker requires
S3-F6, F9, F10, F12, F13, F14, F15, and F16 to feed S3-F17.

<!-- stage3-release-feature: S3-F1 | exit=S3-F1-T5 | depends= -->
<!-- stage3-release-feature: S3-F2 | exit=S3-F2-T7 | depends=S3-F1 -->
<!-- stage3-release-feature: S3-F3 | exit=S3-F3-T5 | depends=S3-F2 -->
<!-- stage3-release-feature: S3-F4 | exit=S3-F4-T3 | depends=S3-F3 -->
<!-- stage3-release-feature: S3-F5 | exit=S3-F5-T3 | depends=S3-F2,S3-F3,S3-F4 -->
<!-- stage3-release-feature: S3-F6 | exit=S3-F6-T4 | depends=S3-F2,S3-F3,S3-F4,S3-F5 -->
<!-- stage3-release-feature: S3-F7 | exit=S3-F7-T4 | depends= -->
<!-- stage3-release-feature: S3-F8 | exit=S3-F8-T4 | depends=S3-F7 -->
<!-- stage3-release-feature: S3-F9 | exit=S3-F9-T5 | depends=S3-F7 -->
<!-- stage3-release-feature: S3-F10 | exit=S3-F10-T4 | depends=S3-F7 -->
<!-- stage3-release-feature: S3-F11 | exit=S3-F11-T5 | depends=S3-F7,S3-F10 -->
<!-- stage3-release-feature: S3-F12 | exit=S3-F12-T5 | depends=S3-F3,S3-F7,S3-F10 -->
<!-- stage3-release-feature: S3-F13 | exit=S3-F13-T4 | depends=S3-F7,S3-F8,S3-F9,S3-F10,S3-F11,S3-F12 -->
<!-- stage3-release-feature: S3-F14 | exit=S3-F14-T5 | depends=S3-F10 -->
<!-- stage3-release-feature: S3-F15 | exit=S3-F15-T5 | depends=S3-F6,S3-F10,S3-F12 -->
<!-- stage3-release-feature: S3-F16 | exit=S3-F16-T5 | depends=S3-F10,S3-F15 -->
<!-- stage3-release-feature: S3-F17 | exit=S3-F17-T5 | depends=S3-F6,S3-F9,S3-F10,S3-F12,S3-F13,S3-F14,S3-F15,S3-F16 -->

Current truth: S3-F1-F4 core tasks are complete. Required exits F5/F6, F7-F16,
and supporting live rows remain open where their task boards say so. S3-F17-T2
and T3 therefore remain blocked; S3-F17-T4 cannot begin as a completion review.

## Execution evidence

| Gate                                          | Result  | Evidence or blocker                                                                                 |
| --------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------- |
| Release-ledger coverage                       | PASS    | 18 active changes, 315 normative scenarios, 17 feature exits                                        |
| All active OpenSpec strict validation         | PASS    | all 18 non-archive changes; final-commit rerun is required for handoff                              |
| Node 22 `npm run check`                       | PASS    | lint, format, typecheck, unit/integration tests, production build; final-commit rerun is required   |
| Migration/security/concurrency/focused suites | PASS    | 52 focused files, 461 passed, 3 intentionally skipped; full migration chain has 20 entries          |
| Production/dev MCP separation                 | PASS    | focused SDK/security suites plus isolated authenticated dev-test-control API                        |
| Usage daemon smoke                            | PASS    | three repeated duplicate/crash/restart/clean-stop runs after early-signal race fix                  |
| Verified `Flapstack Dev cf53`                 | PASS    | isolated ports/profile; exact checkout, Electron main path, API, DB, and clean shutdown             |
| macOS Preview build/inspect/smoke/launch      | PASS    | unsigned arm64 package; ABI/licenses/pinned runtimes; exact executable startup, migration, shutdown |
| Visual Settings/MCP/Usage/reasoning           | BLOCKED | macOS session locked (`CGSSessionScreenIsLocked=Yes`); no headless substitution                     |
| Clipboard, microphone, Keychain               | BLOCKED | require unlocked interactive macOS evidence                                                         |
| Windows/Linux                                 | BLOCKED | target hosts unavailable                                                                            |
| Independent review rounds                     | BLOCKED | S3-F17-T4 requires completed T2 and T3                                                              |

## Cleanup and evidence invalidation

Each run uses unique dev instance/profile, port, database, service label, test
chat/run IDs, provider config, and temporary sidecar path. Cleanup must prove:

- no dev or Preview process from this checkout;
- no pending approvals, unarchived probe chats, exposed production MCP child,
  provider sidecar, or stale dev registration;
- no temporary profile, database, service, credential, webhook, package, or
  ignored native/build artifact left by the lane;
- no credential, private reasoning, or raw provider payload in tracked files,
  logs, SQLite evidence, or shell arguments;
- main worktree and `main` branch unchanged.

The final handoff records exact commit, commands, PASS/FAIL/BLOCKED rows,
remaining acceptance tasks, and whether independent review rounds may start.

# Stage 3 full-feature test matrix

Snapshot: 2026-07-13. This is the active user-facing exit matrix for Stage 3.
OpenSpec `tasks.md` files remain the only implementation task checklists. This
document records integrated and manual evidence; it does not replace them.

Stage 3 is complete only when all required rows pass on the named platforms.
Blocked or unavailable evidence stays unchecked and is reported as a limitation.

## 0. Identity and automated gate

- [x] **S3-P01** `codex/stage3-integration` contains current `main`; `main` is
      clean and unchanged by Stage 3 development.
- [x] **S3-P02** Node 22 `npm run check` passes after the final code change.
- [x] **S3-P03** every active Stage 3 OpenSpec change passes strict validation.
- [x] **S3-P04** fresh, `main`-era, and supported legacy databases migrate
      without losing Stage 2 data; schema and Drizzle journal match.
- [ ] **S3-P05** `npm run dev:verify` identifies this checkout and the
      `Flapstack Dev` profile after the final restart.
- [ ] **S3-P06** macOS Preview packaging passes; Windows/Linux package evidence
      is recorded as passed or explicitly remaining.

## 1. Production MCP control (S3-F2 through S3-F6)

- [ ] **S3-M01** per-chat exposure is off by default and only the selected chat
      receives the production stdio server.
- [ ] **S3-M02** Tier 0 reads are paginated, scoped, redacted, and reachable in
      read-only Claude and Codex without allowing arbitrary third-party MCP tools.
- [ ] **S3-M03** mutations enforce caller identity, permission mode, worktree
      boundary, self-reference rules, and exactly one user approval where required.
- [ ] **S3-M04** Tier 3 launch/spawn always requires fresh approval; denial,
      timeout, success, and failure each create one complete audit record.
- [ ] **S3-M05** queued Claude/Codex launches reuse one run ID, survive restart
      according to policy, and cannot drain unrelated pending runs.
- [ ] **S3-M06** product MCP mutations refresh affected renderer queries without
      restart; dev-test MCP remains a separate authenticated test boundary.
- [ ] **S3-M07** audit filtering, pagination, approval UI, exposure controls,
      connection state, and self-reference diagnostics pass in the live dev app.
- [ ] **S3-M08** every spawned chat shows an accessible fork marker and durable
      two-way parent/child navigation; one named task contains the initiating chat
      and all descendants whether created from UI or product MCP.
- [ ] **S3-M09** one orchestration runs heterogeneous worker definitions with
      resolved role/spec, harness/provider, model/effort, permissions,
      worktree/branch strategy, dependencies, and completion criteria.
- [ ] **S3-M10** the durable scheduler enforces per-task parallelism and
      dependencies across concurrent drains, pause/resume, retry/replace/add,
      crashes, and restart without duplicate launches or completed-work replay.
- [ ] **S3-M11** completion/progress, wall-clock, token/cost, failure/blocker,
      and manual stops prevent new launches and record honest stop reasons; exact
      cost is used only from authoritative provider data and estimates are labeled.
- [ ] **S3-M12** the task UI and product MCP agree on aggregate progress, worker
      states, usage/cost provenance, dependencies, lineage, results, controls,
      audit, and post-commit renderer invalidation; loop, depth,
      duplicate-ancestor, stale-identity, permission, and audit attacks fail closed.

2026-07-13 security repair evidence: fresh per-call invocation UUIDs and
context-bound durable approvals reject replay; product-MCP disable atomically
invalidates running identities and revokes active sessions; mutation audit
storage failure blocks dispatch; completion-audit failure leaves an explicit
durable reconciliation trail; redaction fixtures exclude credentials, URLs,
environment assignments, nested arbitrary text, and attachment content; rooted
write swap attacks fail closed. Live approval/exposure UI remains unchecked.

2026-07-13 security repair round-2 evidence: product MCP authority now requires
launcher-owned registration identity, and a reserved third-party name is
preserved under an explicit non-product alias. Exposure disable revokes only
mapped product-enabled child runs. Every tier requires a durable pre-dispatch
audit claim; terminal append failure exposes a reconciliation ID and blocks the
same blind retry. Arbitrary strings hash by default, including AWS-style and
path-embedded secrets. Files-router traversal, absolute-path, symlink, and
namespace-swap attacks fail closed. Live UI and platform rows stay unchecked.

2026-07-13 security repair round-3 evidence: all file reads, recursive listing,
watches, attachment persistence, and adjacent project-root procedures require
durable rooted contracts. Registered roots bind canonical realpath and
filesystem identity where available; moved, replaced, symlinked, traversal, and
arbitrary absolute targets fail closed. All case-insensitive reserved MCP name
collisions are renamed without product elevation. Terminal-audit recovery is
durable, restart-safe, bounded to one explicit retry for retry-safe input, and
keeps exact non-idempotent unknown outcomes blocked without poisoning different
input. Continuous namespace races, reparse behavior, cross-resource
exactly-once, and all live UI/platform rows remain unproved and unchecked.

2026-07-13 MCP-first closeout evidence: the authenticated dev-test MCP drove
all functional actions through real product stdio children. Default-off,
enable/connected truth, Codex and Claude `ping`/`describe`, two-way durable
spawn lineage, approval/denial, stop/invalidation, audit filtering/paging,
restart persistence, and isolated cleanup were observed. Claude-to-Codex
launched a real Codex run successfully; Codex-to-Claude created honest lineage
but the real Claude run failed because the dev checkout lacked its bundled
Claude binary/provider stream. Computer Use was limited to accessibility/focus
evidence for the background Review control under the shared UI lease. The full
provider-session and visual matrix remains unchecked; S3-F5-T3 and S3-F6-T4
are not complete.

2026-07-13 S3-F5 orchestration implementation evidence: migration 0022 and
focused service, restart, concurrent-drain, budget/stop, lineage, permission,
approval/audit, invalidation, and component/accessibility suites pass. The Node
22 canonical gate passed 115 files with 866 tests passed and 3
credential-conditional skips plus lint, formatting, TypeScript, and production
build. Both affected OpenSpec changes strict-validate. `Flapstack Dev c8ae`
passed exact checkout/profile verification after restart. Authenticated
dev-test MCP created and controlled task
`28947dc5-88a7-4150-a2b9-6e06d8566a1a` using read-only deferred workers and
create/read/pause/replace/retry/add/progress/stop/archive; no provider
launched and estimated cost stayed labeled. Computer Use only read the live
shell pixels and accessibility tree. No live orchestration task-screen,
real-provider, exact-cost, package, Windows, or Linux claim is promoted, so
integrated S3-M08 through S3-M12 remain unchecked.

2026-07-13 integrated candidate evidence: `codex/stage3-integration` contains
`main`; main remains clean. Node 22.23.1 `npm run check` passed lint,
formatting, TypeScript, 124 test files with 926 passed and 3 conditional skips,
and all production builds. All 18 active OpenSpec changes strict-validate; the
release ledger covers 347 scenarios and 17 feature exits. Fresh and supported
legacy migration coverage passes with security migration 0021 followed by
orchestration migration 0022. Final integrated Dev, Preview, UI, provider, and
cross-platform rows remain unchecked.

## 2. Settings reliability (S3-F7 through S3-F13)

- [ ] **S3-S01** only honest, implemented tabs appear; every visible tab is
      directly routable and searchable.
- [ ] **S3-S02** editable keyboard shortcuts use one registry for display,
      persistence, conflict detection, runtime dispatch, reset, and focus policy.
- [ ] **S3-S03** voice selectors control real adapters/models; Prefer offline,
      voice, playback rate, history, and error/download states match runtime.
- [ ] **S3-S04** secrets use write-only renderer APIs and approved encrypted
      persistence/migration paths; no key appears in logs, IPC, exports, or audit.
- [ ] **S3-S05** provider extensions show accurate discovery, scope, duplicate,
      mutation, and runtime-consumption behavior.
- [ ] **S3-S06** permission changes support current/all-chat scope and remembered
      behavior; custom capabilities persist exactly and clear when custom ends.
      2026-07-13 headless evidence: versioned hierarchy persistence, atomic
      all-chat custom, immutable run snapshots, provider gates, and path-safety
      tests pass. Flapstack Dev verified on Node 22; fresh OpenRouter and NanoGPT
      runs passed and were archived. Visual Settings, Codex project-boundary,
      and legacy-change workflow remain unchecked because the Mac was locked.
      Full Node 22 check passed (730 passed, 3 skipped); unsigned macOS Preview
      packaging contains migration 0019 and both ACP bridge patches.
- [ ] **S3-S07** copy and Settings search use the same visibility/route registry
      and never expose unavailable destinations or stale provider claims.
      2026-07-13 headless evidence: the release registry owns indexed major
      controls, provider scope, dynamic provider availability, search copy, and
      stable targets. Hidden/development/provider-ineligible destinations stay
      unindexed. Credential and provider-extension targets are focusable.
      Current/legacy full-history copy and active/cross-chat search cover visible
      reasoning and structured questions/answers while excluding opaque/private
      fields and arbitrary tool payloads; copy retains allowlisted tool summaries.
      Focused coverage passed 43 tests. Strict OpenSpec and Node 22.23.1 full
      check passed with 101 test files, 749 passed, 3 credential-conditional
      skipped, and the production build complete. Visual search/copy review,
      F8-F12 live acceptance, package checks, and Windows/Linux stay unchecked.

### Settings closeout candidate evidence - 2026-07-13 PDT

- Candidate: isolated `609c` worktree on
  `codex/stage3-settings-live-closeout`, starting from
  `d08502ec16764653df589894c7a1c6ecacc87ce9`.
- Functional control: the loopback development test-control MCP requires its
  random bearer token and mode-`0600` descriptor. It controls project/Settings
  selection, shortcut state, credential lifecycle, provider extensions,
  permissions, bounded visible copy/search, test-chat selection, and reversible
  fixture cleanup. Renderer DTOs reject malformed commands; project and chat
  paths resolve from persisted identities instead of caller-supplied paths.
- Live MCP: exact `Flapstack Dev 609c` state covered Settings open/close,
  navigation, search, project clear/reselect, hidden destinations, shortcut
  set/conflict/restart/reset, disposable credential migration/removal,
  content-redacted extension inventory and rooted project mutation, exact
  custom permission persistence/preview, and visible-only chat search.
- Real UI/OS under the shared lease: Keyboard pixels and accessibility,
  custom-key delivery, composer-focus suppression, Cmd+F focus, Down/Enter
  Settings search navigation, blank write-only credential fields, message
  clipboard, and full-history clipboard passed. Functional setup and assertions
  stayed MCP-first; Computer Use was limited to pixels, accessibility, focus,
  and keyboard/clipboard delivery.
- macOS development credential evidence reported the available Keychain backend
  with a mode-`0600` ciphertext store and no disposable plaintext. This does not
  promote packaged Keychain behavior.
- Current unsigned macOS arm64 Preview build, architecture/resource/license
  inspection, and bundled Claude/Codex/Whisper/Parakeet smoke pass. Current
  Preview launch, packaged credential/provider discovery, Windows, and Linux
  remain open.
- Node 22.23.1 `npm run check` passed lint, formatting, TypeScript, 119 test
  files with 879 passing and 3 skipped tests, and the production build. Strict
  validation passed for Settings, global provider permissions, provider
  harness closeout, and development test-control MCP. Release-ledger coverage
  passed for 18 active changes, 323 scenarios, and 17 feature exits.
- Result: S3-F8-T4 and S3-F10-T3 close on this candidate. S3-S01 through S3-S07
  remain unchecked until their full feature exits and dependency rows close.

2026-07-13 security repair evidence: the generic credential service and direct
Settings endpoint retire old encrypted values before session-only replacement,
including restart non-resurrection. Hidden current/legacy `file-content` is
excluded from visible search, handoff, clipboard/full-history export, and JSON;
attachment search uses filenames only. Actual OS stores and unlocked UI remain
unchecked.

2026-07-13 security repair round-2 evidence: retained failed-migration sources
for Codex, Voice, and custom Claude are durably tombstoned when the user accepts
an encrypted or session-only replacement, so restart cannot retry stale values.
Current, legacy, and nested dev-message JSON removes `file-content` before both
render and clipboard serialization. Fixture proof does not promote Keychain,
visual, clipboard-interaction, Windows, or Linux rows.

### S3-F13 copy/search evidence - 2026-07-13 PDT

- Base: `5297ed777d0430f468ef23def55119f51d87795b` in the isolated
  `codex/s3-f13-copy-search` worktree.
- Automated: focused Settings/copy/search coverage passed 43 tests. The Node 22
  canonical gate passed lint, formatting, TypeScript, 101 test files with 749
  passed and 3 credential-conditional skipped, and the production build.
- Contract: `complete-settings-reliability` passed strict OpenSpec validation.
- Dev: `npm run dev` loaded the final code; `npm run dev:verify` passed for this
  exact worktree and the `Flapstack Dev` profile. Startup completed migrations,
  created the main window, and shut down cleanly after verification.
- Preserved boundaries: hidden route normalization, promoted Keyboard and
  Custom Agents, write-only credentials, Voice ownership, and separate product,
  development, and third-party MCP identities remain intact.
- Blocked/unavailable: the Mac was locked, so no visual search, target focus,
  pointer, clipboard, credential, provider-extension, permission, or Voice UI
  evidence is claimed. Windows/Linux and final package evidence remain open.

### S3-F11 provider-extension evidence - 2026-07-13 PDT

- Commit: `b02055c56ac7a1c79fa49be49a2ba01730f66d5e`.
- Environment: macOS 26.5.2 arm64; Node 22.23.1; Electron 39.8.10.
- Automated: Node 22 `npm run check` passed with 99 test files, 724 tests
  passed, and 3 credential-conditional tests skipped. Both
  `complete-settings-reliability` and `close-provider-harnesses` passed strict
  OpenSpec validation.
- Dev: `npm run dev` and `npm run dev:verify` identified this checkout and the
  `Flapstack Dev` profile. Authenticated dev test-control inventory returned 74
  user-local items: 51 read-only Claude plugins, 11 writable Claude skills, 5
  read-only third-party Codex MCP entries, and 7 Codex skills, including 6
  compatibility/read-only entries and 1 documented writable entry.
- Mutation: project-scoped create/update/delete passed through the production
  adapter for Claude skill/command/custom-agent, Codex skill, and Cursor
  command. OpenCode skill creation failed closed as read-only. Exact Codex and
  Cursor runtime tokens passed; integrated S3-F11-T4 remains the current Claude
  runtime proof. All temporary files and empty local agent roots were removed.
- Preview: macOS arm64 `Flapstack Preview.app` built, launched from the exact
  worktree bundle, initialized the Preview profile/database/migrations, and
  shut down cleanly. Electron, Claude 2.1.207, Codex 0.144.1, Whisper,
  Parakeet, SQLite, native binaries, and licenses passed package inspection and
  smoke. The packaged main bundle contains the provider discovery/mutation
  implementation. A missing dev descriptor failed closed in Preview.
- Blocked/unavailable: the Mac was locked, so no visual Settings evidence or
  packaged user-local discovery invocation is claimed. Windows/Linux remain
  untested. Therefore S3-S05 and S3-F11-T5 stay unchecked.

## 3. Migrated Stage 2 closeout

The historical row text remains in `docs/stage2-full-feature-test-matrix.md`.
These groups are now owned by Stage 3 features and their OpenSpec task boards.

- [ ] **S3-V01 (S3-F9)** migrated Voice rows `V2-*` through `V9-*` pass with
      Parakeet streaming as the default, Whisper batch fallback, review-before-
      send composer behavior, recording-origin safety, and Voice History CRUD.
- [ ] **S3-V02 (S3-F9)** the active `docs/voice-manual-matrix.md` passes on
      macOS; Windows/package gaps remain explicit until observed.
- [ ] **S3-U01 (S3-F14)** migrated Usage rows `U1-*` through `U11-*` pass for
      engine, store, daemon, providers, reconciliation, alerts, and dashboard.
      2026-07-13 safe evidence: 107 focused tests, matrix coverage, production
      build, duplicate/crash/restart daemon smoke, isolated verified dev,
      read-only Codex/Claude quota probes, and unsigned arm64 Preview
      build/inspection/smoke plus exact process launch/cleanup passed. Locked-Mac
      main initialization and database migration did not run. Node 22 full check
      passed with 102 test files, 745 passed, and 3 credential-conditional skips.
      Visual, Keychain closed-app, packaged-startup, credentialed conditional
      provider, Windows, and Linux rows remain open; S3-U01 is not complete.
- [ ] **S3-H01 (S3-F15)** migrated Cursor rows `D1-*` through `D5-*` and
      OpenRouter/NanoGPT rows `E1-*` through `E7-*` pass in live UI and package
      contexts; NanoGPT defaults name a currently chat-capable tested model.
      Capability and evidence-class mapping:
      `docs/provider-harness-closeout-matrix.md`.
      2026-07-13 headless evidence proves Cursor CLI `auto` continuation,
      persisted OpenRouter/NanoGPT success, NanoGPT `zai-org/glm-latest`, and
      provider allow/deny/cancel integrity. Implementation SHA `99672b7` passes
      Node 22 full check and unsigned Preview arm64 package inspection/smoke.
      This row stays open for verified renderer, locked approval/permission UI,
      cross-platform, and remaining F10-T4/F12-T5 acceptance evidence.
- [ ] **S3-R01 (S3-F16)** migrated reasoning rows `T1-*` through `T7-*` pass for
      fixtures, streaming, persistence, search, capability fallback, and live
      provider evidence.
      2026-07-13 safe closeout: the current F16 tree persists and exposes exact
      OpenRouter/NanoGPT request resolution. Fresh OpenRouter visible, disabled,
      and unsupported-fallback runs and NanoGPT absent/disabled runs passed,
      then restored exact message IDs, controls, and completed timers after a
      verified dev restart. Prior Claude, Codex, Cursor, and NanoGPT visible or
      absent records also restored without fabricated rows. Database inspection
      found no credential pattern; all probes were archived, approvals and
      sidecar temp state are empty. This row stays open because the locked Mac
      prevented visual accessibility/search/screenshot proof and prior
      Claude/Codex/Cursor calls lack a recorded same-tree SHA. Focused suites,
      three related strict OpenSpec validations, Node 22.23.1 full check (101
      files, 754 passed, 3 skipped), production build, and unsigned macOS arm64
      Preview inspect/smoke pass.
- [ ] **S3-C01 (S3-F17)** migrated preflight rows `P-01` through `P-10` and MVP
      carryover rows `F3-*` through `F11-*` pass without regressing Stage 1/2.

## 4. Final integrated release gate (S3-F17)

- [ ] **S3-X01** a clean-profile walkthrough creates/opens project, task, chat,
      worktree, run, artifact, checkpoint, and production MCP control paths.
- [ ] **S3-X02** Claude, Codex, Cursor, OpenRouter, and NanoGPT each pass every
      credential-available launch, permission, reasoning, and persistence path.
- [ ] **S3-X03** restart recovery, database migration, daemon lifecycle, and
      product MCP external mutation refresh pass after the final code change.
- [ ] **S3-X04** macOS live dev and Preview package pass. Windows/Linux checks
      are run where available and otherwise recorded as unverified, never implied.
- [ ] **S3-X05** three review/fix rounds find no unresolved correctness,
      security, data-loss, permission, migration, or release-blocking issue.
- [ ] **S3-X06** README, UI guidance, OpenSpec proposals/specs/designs/tasks,
      stage routers, test matrices, and handoff all describe the same shipped
      behavior and remaining limitations.

### S3-F17 safe closeout evidence — 2026-07-13 PDT

- Candidate: isolated `cf53` worktree from integration baseline
  `fba7e32bec5db21233d17b82a8745e974de90293`; exact resulting commit is in the
  final handoff.
- Automated: release-ledger coverage maps 18 active changes, 315 scenarios, and
  17 feature exits; all active strict validation, Node 22 full/focused suites,
  migrations, MCP security/redaction, Usage daemon smoke, and production build
  pass. The daemon smoke exposed an early-signal startup race; the fixed gate
  has regression coverage and passes repeated lifecycle smoke.
- Dev: `Flapstack Dev cf53` used an isolated profile and ports. `dev:verify`,
  authenticated test-control status calls, 20-migration SQLite inspection, and
  zero chat/run/approval/audit/exposure/usage/Voice-artifact cleanup queries
  pass.
- Preview: unsigned macOS arm64 build, architecture/resource/license inspection,
  pinned Claude/Codex/Whisper/Parakeet runtime smoke, exact executable startup,
  20 migrations, and clean shutdown pass. A stale global `flapstack_dev` test
  registration was removed, then the exact executable relaunched without the
  prior MCP registration error.
- Blocked: `CGSSessionScreenIsLocked=Yes`; visual/accessibility, clipboard,
  microphone, Keychain, approval-dialog, Voice, Usage, reasoning, and live
  provider rows remain open. Windows and Linux are unavailable. Consequently
  S3-C01 and S3-X01 through S3-X06 remain unchecked.

### Agent UX continuation — 2026-07-13

- Authenticated MCP proved bounded Voice and Usage reads, provider credential
  absence, all-adapter injected question lifecycle, stored two-file Review,
  conflict-safe Undo, non-overlap preservation, overlap blocking, and cleanup.
- Functional setup/assertion/cleanup used MCP. The leased Dev launch was the only
  real-app interval; no Computer Use, keyboard, mouse, clipboard, microphone,
  native-dialog, focus, or pixel evidence was added.
- The exact synthetic chat selection succeeded but its transcript did not mount,
  so reasoning and run-change visual rows remain open. No S3-X row is promoted.

## Evidence record

Record one entry per run:

```text
Date/time:
Commit:
OS + architecture:
Node/Electron version:
Dev or Preview/package:
Row IDs:
Passed:
Failed:
Blocked/unavailable:
Provider/CLI versions (no secrets):
Logs/screenshots:
Notes:
```

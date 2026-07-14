# Stage 3 release candidate ledger

Status: integrated Stage 3 automation verified. This ledger does not claim
Stage 3 release completion while real-provider, complete live UI, credential,
package, or platform rows remain open.

OpenAI/Anthropic Admin usage validation and Apple public-distribution signing/
notarization are deferred to `docs/future-release-considerations.md`. Neither is
a Stage 3 acceptance row.

## Candidate header

- Candidate source: the exact commit containing this ledger, resolved with
  `git rev-parse HEAD` and recorded in the final handoff after commit.
- Integration baseline: `821c9cd2d6b1c2931da52b98f19eab23b3e965db`.
- Checkout: `/Users/michaelshi/.codex/worktrees/cdd7/flapstack` on
  `codex/stage3-release-final-cdd7`; `main` remains untouched.
- Profile isolation: worker-lane Dev and Preview evidence remains historical
  until the integrated candidate reruns its exact checkout/profile gates.
- Supported release runtime: Node 22. macOS arm64 is locally available;
  Windows and Linux are unavailable in this lane.
- Result vocabulary: only PASS satisfies a required row. FAIL, BLOCKED, and
  NOT RUN remain release-open.

Any code, test, spec, or release-document change advances the candidate. The
affected rows and full automated gate rerun on the new commit. Evidence from a
different SHA is context only.

## Stable release rows

| Row family                                          | Scope                                                                      | Evidence source                        |
| --------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------- |
| `S3-P01`-`S3-P06`                                   | identity, full gate, strict validation, migrations, dev identity, packages | this ledger and full-feature matrix    |
| `S3-M01`-`S3-M12`, `M-01`-`M-20`                    | production MCP, approvals, audit, spawn, orchestration, restart            | full-feature matrix and headless audit |
| `S3-S01`-`S3-S07`                                   | Settings, credentials, extensions, permissions, copy/search                | full-feature and credential matrices   |
| `S3-V01`-`S3-V02`                                   | Voice automation and manual macOS/Windows behavior                         | Voice matrix                           |
| `S3-U01`, Stage 3 rows in `U1-01`-`U11-05`          | Usage, daemon, provider, alert, dashboard                                  | Usage exit matrix                      |
| `S3-H01`, `D0-01`-`D5-02`, `E1-01`-`E7-03`          | Cursor, OpenRouter, NanoGPT                                                | provider closeout matrix               |
| `S3-R01`, `R-FIXTURE`, `R-LIVE`, `R-UI`, `R-RELOAD` | reasoning classification, controls, persistence, live providers            | reasoning capability matrix            |
| `S3-C01`, `S3-A01`-`S3-A07`                         | Stage 1/2 carryover and supporting active changes                          | full gate plus focused live rows       |
| `S3-X01`-`S3-X06`                                   | integrated walkthrough, review, docs, cleanup                              | this ledger and full-feature matrix    |

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
<!-- stage3-release-change: add-stage3-mcp-control | rows=S3-M01,S3-M02,S3-M03,S3-M04,S3-M05,S3-M06,S3-M07,S3-M08,S3-M09,S3-M10,S3-M11,S3-M12 -->
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

Current truth: S3-F1-F5 core tasks are complete. Required exits F6 and F7-F16,
plus supporting live rows, remain open where their task boards say so. S3-F17-T2
and T3 therefore remain blocked; S3-F17-T4 cannot begin as a completion review.

## Execution evidence

| Gate                                   | Result  | Evidence or blocker                                                                                                         |
| -------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| Release-ledger coverage                | PASS    | exact counts are enforced by `npm run check:stage3-release-ledger`                                                          |
| Affected OpenSpec strict validation    | PASS    | all 18 active changes pass strict non-interactive validation                                                                |
| Node 22 `npm run check`                | PASS    | lint, format, TypeScript, 124 files, 926 passed, 3 conditional skips, all production builds                                 |
| Security round-3 focused suite         | PASS    | 11 focused files, 60 passed; rooted reads, attachment namespace, identity, collision, temp, recovery, and migration attacks |
| Final security/control review          | PARTIAL | 12 Node 22 non-native files, 72 passed; native SQLite reruns remain with coordinator ABI/full gate                          |
| S3-F5 focused and attack suites        | PASS    | integrated Node 22 reconciliation suite passed 8 files and 62 tests                                                         |
| MCP-first management closeout          | PARTIAL | 11 focused files, 54 passed; real Claude-to-Codex target passed, reverse Claude target and full visual matrix remain open   |
| Production/dev MCP separation          | PASS    | focused SDK/security suites plus isolated authenticated dev-test-control API                                                |
| Usage daemon smoke                     | PASS    | three repeated duplicate/crash/restart/clean-stop runs after early-signal race fix                                          |
| Verified lane Dev profiles             | PASS    | isolated `93ea`, `609c`, `acbf`, and `c8ae` worker checkouts/profiles; integrated profile rerun pending                     |
| macOS Preview build/inspect/smoke      | PASS    | current unsigned arm64 package; ABI/licenses/pinned runtimes; current executable launch not run                             |
| Settings keyboard/search/credential AX | PASS    | MCP-first state plus real pixels, accessibility, focus, custom-key delivery, and search navigation                          |
| Settings clipboard and Dev Keychain    | PASS    | actual message/full-history clipboard; disposable encrypted Dev store, mode 0600, no plaintext, cleanup                     |
| Visual orchestration and MCP UI        | PENDING | component/AX worker proof exists; integrated task-screen, focus, keyboard, and full visual matrix remain                    |
| Remaining live/package feature rows    | BLOCKED | provider-extension packaged discovery, packaged credential restart, other feature exits, microphone, paid-provider proof    |
| Windows/Linux                          | BLOCKED | target hosts unavailable                                                                                                    |
| Independent review rounds              | BLOCKED | S3-F17-T4 requires completed T2 and T3                                                                                      |

### 2026-07-13 Settings closeout candidate

The authenticated development MCP now covers every functional action/read used
for this lane: project selection, Settings state/navigation/search, shortcut
configuration, credential lifecycle, provider extensions, permission defaults
and chat modes, bounded visible copy/search, and exact test-chat selection. The
server is development-only, loopback-bound, bearer-authenticated, and publishes
a mode-`0600` descriptor. Renderer commands and invalidations use bounded DTOs;
projects and chats resolve from persisted identities, and credential responses
remain redacted.

MCP proved the functional state. Real UI under the shared machine lease was
limited to pixels, accessibility, focus, keyboard delivery, and actual
clipboard behavior. Keyboard custom binding delivery and composer suppression,
Settings Cmd+F plus Down/Enter navigation, blank credential fields, and message
and full-history clipboard passed. Disposable credential, extension, permission,
shortcut, and chat changes were removed, restored, or reversibly archived.

S3-F8-T4 and S3-F10-T3 close. S3-F7-T4, S3-F10-T4, S3-F11-T5, S3-F12-T1
through T5, and S3-F13-T1 through T4 remain open on their recorded legacy,
package, dependency, every-target, and platform evidence. No Preview-launch,
packaged Keychain, Windows, Linux, or unavailable paid-provider claim is made.

### 2026-07-13 security repair round

The delegated security/permissions review found seven required defects. The
repair tree now binds approvals to fresh invocation/context identity, revokes
and durably invalidates product-MCP children on disable, retires encrypted
credentials before session replacement, stores allowlisted audit summaries,
keeps hidden file payloads out of search/handoff/clipboard/export, blocks
mutations when the final pre-execution audit cannot persist, and shares one
rooted writer across MCP and renderer attachment writes. Attack regressions and
the Node 22 full gate pass. This hardening does not turn the blocked live,
package, platform, T2/T3, or formal T4 rows into PASS.

The rooted writer uses no-follow exclusive creation where the host supports it,
same-parent atomic replacement, and root/parent/final identity and realpath
checks immediately around commit. Node has no portable cross-platform
directory-handle `openat`/`renameat` transaction, so continuous namespace races
and Windows reparse-point behavior remain unproved. No locked-UI, Keychain,
Windows, Linux, or paid-provider evidence is claimed.

### 2026-07-13 security repair round 2

The adversarial re-review found nine more required defects. The repair tree now
roots files-router writes, rename, and trash in a registered worktree or durable
sub-chat identity; routes renderer secure-fs writes through the shared rooted
writer; classifies product MCP only from launcher-owned registration identity;
preserves reserved-name third-party servers under an explicit collision alias;
retires retained Codex, Voice, and custom-Claude legacy credential sources;
records a durable `dispatch-started` claim and blocks unresolved duplicate
retry; cancels only product-MCP-enabled child runs on exposure disable; hashes
arbitrary audit strings by default; recursively removes hidden `file-content`
from dev JSON before render and clipboard; and fails closed for every tier when
mandatory pre-dispatch audit storage is unavailable.

Node 22 focused attacks passed 101/101 across 17 files. The canonical Node 22 gate
passed 113 files with 843 tests passed and 3 credential-conditional skips, plus
lint, formatting, TypeScript, and production build. Five affected OpenSpec
changes strict-validate, and ledger coverage passed with 323 scenarios. No live
UI, OS secret-store, package, provider-paid, Windows, or Linux row was promoted.

The durable dispatch claim proves that execution may have started and prevents
a blind duplicate after terminal-audit failure. It cannot provide cross-resource
exactly-once semantics or prove whether a process died between the claim and the
handler. Such an invocation remains explicitly reconciliation-required.

### 2026-07-13 security repair round 3

The six round-3 findings are implemented without promoting any live or platform
row. File reads, recursive listing, watches, attachment persistence, and
adjacent project filesystem procedures use explicit rooted contracts. Durable
root registration binds pathname, canonical realpath, and device/inode where
available; a missing, symlinked, moved, or replaced root fails closed. Every
case-insensitive Claude reserved-name collision is renamed and cannot inherit
product authority.

Secret-bearing replacement validates the original root/parent before a
temporary file exists, and attack tests inspect moved, original, and replacement
parents for surviving payloads or temporary files. Terminal-audit recovery is
durable across restart, bounded, never redispatches during reconciliation, and
distinguishes the same fingerprint from different input. Retry-safe work gets
at most one explicitly authorized recovery retry; an exact non-idempotent
unknown outcome remains blocked until an externally verified outcome is
recorded.

This remains a pathname-revalidation design because Node does not expose a
portable directory-handle `openat`/`renameat` transaction. Continuous namespace
races, Windows reparse behavior, and cross-resource exactly-once outcomes remain
unproved. A legacy pathname has no historical inode to reconstruct: migration
binds only the current real, non-symlink directory and leaves missing/symlinked
legacy roots unbound. Live UI, credentials, packages, macOS interactive
acceptance, Windows, and Linux remain open.

Final round-3 verification: Node 22 focused attacks passed 60/60 across 11
files; `npm run check` passed lint, format, TypeScript, 855 tests with 3
conditional skips, and the production build. All 18 active OpenSpec changes
strict-validate, and release-ledger coverage passes for 323 scenarios and 17
feature exits.

### 2026-07-13 final delegated security/control review

The review found and repaired four required boundary defects: ambient secrets
and Flapstack control-plane identity reached third-party stdio MCP discovery;
remaining Claude credential metadata, prompt previews, raw SDK errors, and
custom endpoint URLs reached logs;
OAuth callback listeners accepted non-loopback binds; and provider-controlled
OAuth errors could be reflected into callback HTML or propagated raw.

The resulting code strips ambient control/credential handles while preserving
explicit per-server configuration, removes credential and endpoint log metadata,
binds both callback servers to IPv4 loopback, reduces provider failures to HTTP
status or generic messages, and HTML-escapes all remaining dynamic callback text.
Caller identity, product/dev/third-party separation, approval revalidation,
audit reconciliation, rooted filesystem boundaries, self-reference, and
spawn/orchestration loops had no further accepted finding.

Node 22 passes 72 tests across 12 non-native focused files; focused ESLint,
Prettier, and diff whitespace checks pass. SQLite-backed attack reruns could not
load because the shared dependency tree was built for the Electron ABI by an
active lane. This lane did not rebuild shared modules or launch/stop Electron;
the coordinator retains the Node 22 native/full gate. No live, package, provider,
platform, S3-X05, or S3-F17-T4 result is promoted.

### 2026-07-13 S3-F5 task orchestration

The local-first vertical slice adds migration `0022_agent_task_orchestration.sql`, durable
task and worker state, bounded dependency scheduling, restart recovery,
completion/time/token/cost/failure/blocker/manual stops, mixed Codex and Claude
definitions, task membership and fork lineage, task controls, product-MCP
approval/audit/invalidation, and authenticated dev-test control.

The live proof used only authenticated dev-test MCP for functional actions:
create, read, pause, replace, retry, add, progress, stop, and archive.
It deferred scheduling, launched no provider, used read-only workers, preserved
five lineage nodes, and labeled cost as estimated rather than exact. Computer
Use only read pixels and the accessibility tree. It did not click, type, or
substitute for MCP coverage. The live task card itself remains visually unproved.

No paid-provider, exact provider-cost, package, Windows, or Linux evidence is
claimed. Attached-branch mode validates an existing Git-registered worktree and
branch; it does not provision branches or worktrees. Security round 3 must
remain preserved across schema, startup scheduler, product MCP, launch, usage,
invalidation, and renderer integration; the integrated rerun is authoritative.

## Cleanup and evidence invalidation

### 2026-07-13 agent UX closeout addendum

The `codex/stage3-agentux-closeout` lane added one provider-neutral request/status
handler across Claude, Codex, Cursor, OpenRouter, and NanoGPT transports; stable
question IDs; shared lifecycle RPCs; clean-profile project/chat/open controls;
and authenticated renderer-state inspection. The final Node 22 gate passed
lint, formatting, TypeScript, 117 test files with 869 tests passed and 3 skipped,
and the production build. All nine affected changes strict-validate.

Live evidence used MCP for project/chat setup, canonical selection, question
injection, owner/renderer state, answers, timeout, approvals, and cleanup. Real
UI evidence was limited to accessibility semantics and keyboard focus while the
shared UI lease was held. The native modal exposed radio semantics and focused
its first option; Tab and Shift-Tab proved option focus order. Injected
continuation conformance passed for Codex, Cursor, OpenRouter, and NanoGPT, but
this is not credentialed provider-live proof.

The unsigned macOS arm64 Preview directory package built successfully. Binary
inspection and smoke passed for Electron 39.8.10, Claude 2.1.207, Codex 0.144.1,
Whisper, Parakeet, and better-sqlite3. No package acceptance row was promoted by
this historical run because no packaged functional run was claimed. The absent
Developer ID identity is deferred public-distribution work, not a Stage 3 gate.

No Usage, Voice, reasoning-provider, Windows, Linux, Keychain, microphone, or
credentialed provider row is promoted by this addendum. Q12/Q13, `AQ-F4-T2`,
`AQ-F5-T1`, undo/review `4.4`, `S3-F14-T3`-`T5`, `S3-F15-T2`-`T5`,
`S3-F16-T3`-`T5`, and `S3-F17-T2`-`T5` remain open.

The continuation from candidate `03ef5bf` adds authenticated bounded controls
for Voice, Usage, stored run Review/Undo, and renderer carryover disclosures.
Live MCP proved a two-file stored Review, successful inverse merge preserving a
non-overlapping later edit, and atomic conflict blocking for an overlapping edit.
It exposed and fixed macOS canonical-path result names. Synthetic reasoning did
not mount in the live renderer, so no visual row is claimed. All previously
listed open IDs remain open; only dev-test-control tasks 2.11 and 3.7 are added
as completed implementation coverage.

Final continuation gates: Node 22 `npm run check` passed 125 files, 932 tests,
3 credential-conditional skips, lint, formatting, TypeScript, and production
build. Ten affected strict OpenSpec changes, the release ledger, the
29-row/14-scenario Usage matrix, and daemon smoke pass. The unsigned
macOS arm64 Preview build, binary inspection, and bundled runtime smoke pass;
zero signing identities remain a post-Stage-3 public-distribution consideration.

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

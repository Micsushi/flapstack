# Stage 3 integrated release handoff

Status: exact-candidate implementation, automation, providers, Usage refresh,
Dev, and macOS Preview evidence are green. Stage 3 remains blocked only on the
recorded locked-macOS manual rows and exact packaged Usage daemon proof.

OpenAI/Anthropic Admin usage validation and Apple public-distribution signing/
notarization are explicitly deferred to `docs/future-release-considerations.md`
and do not block Stage 3.

## Current candidate

- Baseline: `main` at `bf56fe7d3ea2aada98902f4466f7aaad5832a0da`.
- Evidence candidate: `0a3d1af16777332dcbbe60134a4927c8dcff368b`;
  resolve the later documentation commit with `git rev-parse HEAD`.
- Branch: `codex/stage3-integration` in
  `/Users/michaelshi/Documents/GitHub/temp/flapstack-s3-integration`.
- Runtime: Node 22 on macOS arm64; exact Dev used 22.22.1 and the final
  documentation gate used 22.23.1.
- Exact integrated automation, migrations, strict OpenSpec, release-ledger,
  Dev, credentialed providers, Usage refresh, Discord transport, and unsigned
  Preview build/startup pass. Remaining proof is listed below.
- `main` remains untouched. No push, merge, publish, or OpenSpec archive was done.

## Historical Settings lane candidate

- Starting baseline: `d08502ec16764653df589894c7a1c6ecacc87ce9`.
- Lane candidate: resolve the original Settings lane commit from its recorded evidence.
- Branch: `codex/stage3-settings-live-closeout` in the isolated `609c` worktree.
- Runtime: Node 22.23.1 on macOS arm64. Exact `Flapstack Dev 609c` MCP and
  shared-lease UI proof passed; current Preview build/inspect/smoke passed
  without launching the packaged UI.
- Main and integration worktrees were read-only. No push, merge, publish, or
  OpenSpec archive was done.

## Historical Settings lane result

- S3-F8-T4 and S3-F10-T3 are complete. Keyboard runtime/edit/conflict/reset,
  restart persistence, real key delivery/focus suppression, write-only
  credential management, exact Dev encrypted-storage evidence, Settings
  accessibility/search, and actual clipboard behavior pass.
- Functional live actions and assertions used the authenticated development
  MCP. Computer Use was limited to pixels, accessibility, focus, keyboard
  delivery, and clipboard initiation; the clipboard was read from the local OS.
- Node 22.23.1 `npm run check` passes lint, formatting, TypeScript, 119 test
  files with 879 passing and 3 skipped tests, and the production build. Four
  affected strict OpenSpec validations and the 323-scenario release ledger pass.
- S3-F7-T4, S3-F10-T4, S3-F11-T5, S3-F12-T1 through T5, and S3-F13-T1 through
  T4 remain open. GPP-T4, GPP-T6, and GPP-T9 remain supporting blockers.

- S3-F17-T1 is complete. The release ledger covers all active scenarios and
  feature exits and rejects coverage/dependency drift automatically.
- S3-F17-T2 and T3 remain open. Reproducible local gates pass, but listed
  prerequisite exits and required live/UI/platform rows are still open.
- S3-F17-T4 has not started because T2 and T3 are incomplete.
- S3-F17-T5 remains blocked by T2, T3, and T4. No active change was archived.

The exact final command results and commit are reported with the branch handoff.
The durable row truth lives in `docs/stage3-release-candidate-ledger.md` and
`docs/stage3-full-feature-test-matrix.md`.

## Security repair round

Seven delegated security/permissions findings were repaired on a fresh
`cf293cd`-based worktree. Focused attack tests cover approval-ID replay,
disable/re-enable identity revocation, credential restart non-resurrection,
audit secret/content exclusion, hidden file-content exclusion, audit-storage
failure before and after dispatch, and parent/final symlink swaps. Node 22 full
check and affected strict OpenSpec validation pass. The exact commit is the
commit containing this handoff; no push was performed.

The portable rooted writer cannot claim an exact filesystem transaction against
a continuously racing namespace or untested Windows reparse behavior. Locked
UI, actual macOS Keychain, Windows Credential Manager, Linux Secret Service,
package/platform, and paid-provider proof remain open and unclaimed.

## Security repair round 2

Nine adversarial findings were repaired from exact integration baseline
`5a3cebd`. Files-router and renderer writes now use rooted identity validation;
product MCP classification requires trusted launch registration; reserved-name
third-party servers keep third-party authority under explicit aliases; stale
Codex, Voice, and custom-Claude migration sources are durably retired;
post-dispatch terminal-audit failure leaves a retry-blocking reconciliation ID;
exposure disable cancels only product-enabled children; audit strings hash by
default; current and legacy dev JSON remove hidden file content before render
or clipboard; and Tier 0 through Tier 3 all require durable pre-dispatch audit.

Node 22 focused attacks passed 101/101. The full gate passed 113 files with 843
tests passed and 3 conditional skips, lint, formatting, TypeScript, and build.
The five affected OpenSpec changes and the 323-scenario release ledger pass.
All locked, live UI, package, provider, Keychain, Windows, and Linux rows remain
open. Claim-before-dispatch prevents blind retry but cannot guarantee
cross-resource exactly-once behavior after process death.

## Security repair round 3

Six adversarial findings were repaired from exact integration baseline
`1621001`. Files read/list/watch and adjacent attachment/project filesystem
procedures now require registered-root relative targets or durable sub-chat
attachment/plan ownership. Root registration is migration-safe and binds
canonical realpath plus device/inode where supported. Replaced/symlinked roots
fail before read, write, rename, or trash. Every Claude case-insensitive reserved
collision is renamed, and permission classification accepts only exact trusted
registration metadata.

Failed namespace-swap tests search original, moved, and replacement parents and
prove no secret payload or temporary file survives the deterministic attack.
Terminal audit claims now recover durably across restart into retry-safe,
unknown, reconciled, or exhausted states without blind redispatch. Retry-safe
fingerprints get one explicit bounded retry; exact non-idempotent unknown
outcomes remain blocked without poisoning different input.

No exact continuous namespace-race, Windows reparse, or cross-resource
exactly-once guarantee is claimed. Live/UI/package/credential/macOS interactive,
Windows, and Linux rows remain unchecked. Legacy rows have no historical inode
to reconstruct; migration binds only the current real non-symlink directory and
leaves missing or symlinked roots unbound.

Node 22 focused round-3 attacks passed 60/60 across 11 files. The full
`npm run check` passed lint, format, TypeScript, 855 tests with 3 conditional
skips, and the production build. All 18 active OpenSpec changes strict-validate;
the release ledger covers 323 scenarios and 17 feature exits.

## MCP-first management closeout

The isolated `93ea` dev instance used authenticated test-control MCP for every
functional product action. Both caller identities passed default-off,
enable/connected, `ping`, and `describe`. Claude-to-Codex produced a successful
real Codex child with exact lineage and response. Its initial Codex-to-Claude
attempt produced honest lineage but failed because the checkout lacked its
ignored bundled Claude binary. Two-way denial, pending-call stop, stale
identity, audit paging/filtering, restart persistence, and cleanup passed.

The integration repair now prefers the bundled Claude binary and falls back
only for development to an executable Claude CLI from the shell PATH. Packaged
resolution stays pinned and fail-closed. In verified `Flapstack Dev s3fix`,
authenticated test-control MCP launched a real Claude child from a Codex
initiating chat; task `92ef9d73-2bb4-4b42-9bd9-fdc43fb25bc6` completed with
provider-reported usage and runtime logs recorded `source: path`.

Computer Use was limited to background-approval accessibility/focus evidence
while the shared UI lease was held. It did not drive functional actions. The
lane stopped its app, released the lease, archived all test callers/children,
and left no pending approvals. The missing-Claude-binary blocker is resolved,
but S3-F5-T3 and S3-F6-T1/T2/T3/T5/T4 remain open for their complete approval,
renderer, provider-session, and visual/accessibility matrices.
Node 22 `npm run check` passed lint, formatting, TypeScript, 117 test files with
863 passed and 3 conditional skips, and the production build. The three
affected strict changes and release-ledger coverage pass.

## Remaining Stage 3 proof

- Unlock macOS and visually verify sidebar/active-chat full-history copy,
  current/older message timestamps, the fresh real two-file Review/Undo card,
  and background question notification/badge navigation with multiple chats.
- Rerun the exact packaged Preview Usage LaunchAgent start/poll/restart/cleanup
  smoke while the GUI session is unlocked.
- Finish the remaining question stop/reload/provider-live aggregate and any
  task-board aggregate exits that depend on these manual rows.
- Rerun the frozen-SHA T2/T3 release gate, then complete independent T4 review
  rounds and T5 archive/handoff.

Windows/Linux proof is deferred to the end of Stage 4. Apple signing,
notarization, and OpenAI/Anthropic Admin usage keys are future considerations,
not Stage 3 blockers.

## Agent UX closeout lane

The agent UX lane closed provider-neutral transport/UI defects and expanded the
authenticated dev-test surface. MCP proved exact Dev identity, clean-profile
fixture setup, canonical navigation, native and continuation question ownership,
terminal answer cleanup, explicit expired-continuation state, approval
separation, and reversible cleanup. Real UI proof was limited to modal
accessibility and keyboard focus under the shared lease.

Node 22 `npm run check` passed lint, formatting, TypeScript, 117 test files with
869 tests passed and 3 skipped, and the production build. The unsigned macOS
arm64 Preview package built; binary inspection and Claude, Codex, Whisper, and
Parakeet smoke passed. No signed or packaged functional acceptance is claimed.

This does not complete Q12/Q13 or promote credentialed provider, Usage, Voice,
reasoning, packaged functional, Windows, or Linux rows. The final lane commit is
reported by its delegated handoff; no push is performed.

## Cleanup contract

The exact `609c` Dev process and descriptor are stopped and the shared UI lease
is released. Disposable credentials and provider extensions are removed,
permission defaults are restored, shortcut overrides are reset, and probe chats
are reversibly archived. The isolated development profile and ignored Preview
output are retained as local evidence; they are not production data and are not
tracked by the commit. No user credential or production profile was changed.

The lane removes its isolated `acbf` development profile, generated Preview
output, native staging output, and processes. It does not remove user
credentials or production data.

## Agent UX integrated-candidate continuation

The continuation starts from `03ef5bf` and does not reapply the already
integrated lane commit. Authenticated MCP added bounded Voice, Usage,
run-change, and renderer-disclosure controls. A disposable canonical Git repo
proved stored Review, two-file Undo, preservation of a non-overlapping edit,
and no-write conflict blocking. All fixtures were removed, Voice rate was
restored, Dev stopped, and the shared UI lease was released.

The exact selected fixture conversation did not render its synthetic transcript,
so collapsed/expanded and Review pixels are not claimed. No Computer Use was
used in this continuation. Q12/Q13, AQ-F4-T2, AQ-F5-T1, undo 4.4,
S3-F9-T1-T5, S3-F14-T3-T5, S3-F15-T2-T5, S3-F16-T3-T5, and S3-F17-T2-T5
remain open for their stated provider, visual, platform, or prerequisite gates.

Final headless gates pass on Node 22: 125 test files, 932 passed, 3 skipped,
lint, formatting, TypeScript, production build, all ten affected strict OpenSpec
changes, release-ledger and Usage-matrix coverage, and daemon smoke. Unsigned
arm64 Preview build/inspection/runtime smoke pass; public-distribution signing
is deferred beyond Stage 3.

The later `ee39-ux` live attempt passed exact-checkout Dev verification but was
blocked by locked macOS before Computer Use could begin. Its shared UI lease was
released immediately to `usage-exit-preview`; no additional manual row is
claimed.

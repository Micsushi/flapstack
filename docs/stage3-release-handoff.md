# Stage 3 release lane handoff

Status: Settings closeout implemented and locally verified; Stage 3 release
remains blocked on recorded package, provider, dependency, and platform rows.

## Candidate

- Starting baseline: `d08502ec16764653df589894c7a1c6ecacc87ce9`.
- Candidate: resolve the commit containing this file with `git rev-parse HEAD`.
- Branch: `codex/stage3-settings-live-closeout` in the isolated `609c` worktree.
- Runtime: Node 22.23.1 on macOS arm64. Exact `Flapstack Dev 609c` MCP and
  shared-lease UI proof passed; current Preview build/inspect/smoke passed
  without launching the packaged UI.
- Main and integration worktrees were read-only. No push, merge, publish, or
  OpenSpec archive was done.

## Safe closeout result

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
real Codex child with exact lineage and response. Codex-to-Claude produced
honest lineage but the real Claude child failed because the dev checkout lacked
its bundled Claude binary/provider stream. Two-way denial, pending-call stop,
stale identity, audit paging/filtering, restart persistence, and cleanup passed.

Computer Use was limited to background-approval accessibility/focus evidence
while the shared UI lease was held. It did not drive functional actions. The
lane stopped its app, released the lease, archived all test callers/children,
and left no pending approvals. S3-F5-T3 and S3-F6-T1/T2/T3/T5/T4 remain open
for the missing real-provider and complete visual/accessibility matrix.
Node 22 `npm run check` passed lint, formatting, TypeScript, 117 test files with
863 passed and 3 conditional skips, and the production build. The three
affected strict changes and release-ledger coverage pass.

## Remaining human and platform proof

- Unlock macOS and complete visual/accessibility, clipboard, microphone,
  Keychain credential, approval-dialog, Voice, Usage, reasoning, and provider
  rows on the exact candidate.
- Capture required Claude, Codex, Cursor, OpenRouter, and NanoGPT live evidence
  without fabricating unavailable credentials or capabilities.
- Run Windows and Linux package, secret-store, service, and UI matrices.
- Complete every prerequisite feature exit, then rerun T2 and T3 on one frozen
  SHA before starting independent T4 review rounds.

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

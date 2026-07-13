# Stage 3 release lane handoff

Status: safe S3-F17 closeout complete; Stage 3 release remains blocked.

## Candidate

- Integration baseline: `fba7e32bec5db21233d17b82a8745e974de90293`.
- Candidate: resolve the commit containing this file with `git rev-parse HEAD`.
- Branch: `codex/s3-f17-release-closeout-cf53` in the isolated `cf53` worktree.
- Runtime: Node 22 on macOS arm64; unsigned Preview package.
- Main worktree was read-only. No push, merge, publish, or archive was done.

## Safe closeout result

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

## Remaining human and platform proof

- Unlock macOS and complete visual/accessibility, clipboard, microphone,
  Keychain credential, approval-dialog, Voice, Usage, reasoning, and provider
  rows on the exact candidate.
- Capture required Claude, Codex, Cursor, OpenRouter, and NanoGPT live evidence
  without fabricating unavailable credentials or capabilities.
- Run Windows and Linux package, secret-store, service, and UI matrices.
- Complete every prerequisite feature exit, then rerun T2 and T3 on one frozen
  SHA before starting independent T4 review rounds.

## Cleanup contract

The lane removes its `cf53` development profile, Preview test profile, package
output, native staging output, processes, and the stale global `flapstack_dev`
test registration. It does not remove user credentials or production data.

# Stage 3 release lane handoff

Status: safe S3-F17 closeout complete; Stage 3 release remains blocked.

## Candidate

- Integration baseline: `5a3cebd548acaa10a73fccdee9d97dabcbdd9a2e`.
- Candidate: resolve the commit containing this file with `git rev-parse HEAD`.
- Branch: `codex/stage3-security-fix-r2` in the isolated `426d` worktree.
- Runtime: Node 22.23.1 on macOS arm64. No live app or package was launched in
  this repair lane.
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

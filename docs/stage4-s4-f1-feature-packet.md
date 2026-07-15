# S4-F1 feature-owner packet

Date: 2026-07-14

## Scope and state

- Feature: S4-F1 Unified Skills and Hooks Manager, T1 through T7.
- Base: detached `99181e81798e4c7289a105ec0d84999939d4fb9f`.
- Feature diff: 31 paths after removing both F6-only permission hunks and
  applying the bounded F1 review fixes.
- Accepted integration work was reused, then completed in this feature
  worktree. No commit, merge, push, or task finalization was performed.
- T1, T2, and T4 retain accepted completion. T3, T5, T6, and T7 remain open for
  their declared live, restart, provider-runtime, accessibility, and package
  evidence.

## Implemented feature surface

- Schema-versioned capability registry and native Claude Code, Codex, and Cursor
  adapters with rooted atomic mutation, rollback, preview hashes, and native
  format preservation.
- User/project/task enablement resolver and run-context enforcement with
  unsupported-scope writes rejected.
- Exact-preview cross-harness copy and portable manifests.
- One Extension Manager for native extensions, plugin inventory, and managed
  hooks, including independent filters, support/runtime truth, accessible
  inventory navigation, exact previews, and explicit confirmation.
- Managed-hook import-default-off, validation, bounded dry-run, Tier 3 approval,
  enable/disable lifecycle, revision gates, and redacted audit.
- Provider-extension external-mutation invalidation.
- Stale selected-project handling: retain user inventory, surface the scoped
  refresh error, keep user mutations on cwd-free user inventory, and fail
  project/task native and policy mutation closed until scoped inventory verifies
  the project root.
- Enabled managed hooks can always reach an authority-reducing disable preview
  from their stored record, even when a former project root is stale. Other hook
  lifecycle actions retain revision, root, and approval gates.
- Persisted hook lifecycle changes publish provider-extension invalidation to
  every window. Denied or failed actions publish only when the stored record
  actually changed.

## Verification

- Node 22 focused F1 suite: 11 files, 144 tests passed.
- Node 22 repository gate: `npm run check` passed; 175 files, 1,358 tests passed,
  3 skipped; lint, formatting, TypeScript, and production main/preload/renderer
  builds passed.
- Strict OpenSpec validation for `add-unified-skills-hooks-manager` passed.
- Final stale-project fix checks passed: Prettier, 13 Extension Manager UI tests,
  TypeScript, focused ESLint, and `git diff --check`.
- Final review-fix gate passed under Node 22: 15 focused F1 files / 176 tests,
  TypeScript, focused ESLint, and `git diff --check`. Both permission files
  byte-match base and are absent from the feature diff.
- `npm run dev:verify` proved this checkout and the Flapstack Dev profile.
- Electron Dev walkthrough proved stale-root inventory fallback and disabled
  project mutation, then registered-project inventory and an exact supported
  policy preview. The preview was cancelled; no live policy mutation occurred.

## Truthful remaining gaps

- Apply and restart user/project/task policy changes against supported provider
  runs, including packaged preview.
- Live hook approval, dry-run, enable, disable, restart, and one supported native
  harness runtime execution. Native hook trigger injection remains explicitly
  `not-consumed`.
- Keyboard plus screen-reader observation and platform/package accessibility.
- Windows/Linux and physical-device rows not exercised.
- S4-SH01 through S4-SH04 remain unchecked until their full declared matrix
  evidence exists.

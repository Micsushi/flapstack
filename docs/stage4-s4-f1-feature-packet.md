# S4-F1 feature-owner packet

Date: 2026-07-14

## Scope and state

- Feature: S4-F1 Unified Skills and Hooks Manager, T1 through T7.
- Base: detached `bc3f81479ed66d39b2b29970fc745cab4c18a6dd`.
- This packet contains only the additional F1 repairs made after the integrated
  T1-T7 audit: 20 tracked paths before temporary dependency-link removal.
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
- Enabled hooks reject validation and dry-run until an explicit disable action;
  rejected attempts preserve the record and publish no invalidation.
- Project-hook enablement revalidates its registered root before requesting
  approval and again after approval before persisting. Disable remains
  stale-root-safe.
- Stage 4 direct Codex and Claude launches now consume durable extension policy
  and fail closed on stale filesystem-root authority before provider access.
- Enabled managed hooks are resolved at launch. Claude uses bounded managed
  callbacks; Codex uses modern lifecycle config. Provider hook files remain
  untouched.
- Policy overrides can be cleared from the manager to restore inheritance.
  Project changes reset stale task context and stale projects remain read-only.

## Verification

### Final `bc3f814` repair lane

- Node 22.23.1 focused F1/runtime suite: 14 files / 164 tests passed.
- TypeScript, touched-file ESLint, touched-file Prettier, strict OpenSpec, and
  `git diff --check` passed.
- The one repository-wide `npm run check` attempt acquired the heavy lock and
  passed repository ESLint, then stopped at repository Prettier because the
  unchanged `drizzle/meta/0031_snapshot.json` through `0034_snapshot.json`
  files are not formatted. The test and build phases therefore did not run.
  Those four migration snapshots are outside F1 and byte-unchanged in this
  lane.
- No UI lease was acquired. No Dev, package, provider, screen-reader, Windows,
  or Linux evidence was observed or checked by this owner.

### Reused integrated evidence

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
- Hook-authority review gate passed under Node 22: 15 focused F1 files / 180
  tests, TypeScript, focused ESLint, formatting, and `git diff --check`. No full
  repository, package, or UI gate was rerun for this bounded correction.
- `npm run dev:verify` proved this checkout and the Flapstack Dev profile.
- Electron Dev walkthrough proved stale-root inventory fallback and disabled
  project mutation, then registered-project inventory and an exact supported
  policy preview. The preview was cancelled; no live policy mutation occurred.

## Consolidated acceptance closeout

- The shared heavy lock was free. One unsigned macOS arm64 Preview package,
  binary inspection, and bundled-runtime smoke passed for Electron 39.8.10,
  Claude 2.1.207, Codex 0.144.1, Whisper, Parakeet, better-sqlite3, and packaged
  license files. No signing identity was available.
- `package:preview:mac` packages existing `out/` and does not build it. The
  packaged `out/` timestamp predates the final hook-authority fixes, so the
  successful smoke proves packaging infrastructure and pinned runtimes only;
  it does not prove the final F1 source in-package.
- A temporary isolated profile exercised the production hook service with the
  real bounded runner and `/usr/bin/true`: disabled import, validation, dry-run,
  enable, file-store reload, disable, and a second reload all passed. Temporary
  state was removed and no provider extension file or config was touched.
- The hook smoke used a controlled approval stub. It does not prove the live
  Stage 3 approval surface or provider-observed hook execution.
- Packaged Claude and Codex authentication status succeeded, and an isolated
  Codex API-key credential exists. No provider-policy run was claimed because
  authentication/version proof does not observe whether Flapstack policy
  changed native extension consumption.
- macOS reports `CGSSessionScreenIsLocked=Yes` and `UserIsActive=0`. No visual,
  screen-reader, or packaged interaction row was attempted or claimed.

## Truthful remaining gaps

- Apply and restart user/project/task policy changes against supported provider
  runs, including a package built from the final F1 source.
- Live hook approval/UI interaction and one provider-observed supported native
  harness execution. Headless launch injection is implemented but is not UI or
  provider evidence.
- Keyboard plus screen-reader observation and platform/package accessibility.
- Windows/Linux and physical-device rows not exercised.
- S4-SH01 through S4-SH04 remain unchecked until their full declared matrix
  evidence exists.

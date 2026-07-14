## 1. Recoverable response checkpoints

- [x] 1.1 Capture private Git tree commits in before/after run checkpoints
      without modifying the user's branch, index, commits, or worktree.
- [x] 1.2 Retain checkpoint trees under private refs and tolerate unavailable
      capture by leaving historical/unsupported runs review-only.
- [x] 1.3 Build response manifests and aggregate line counts from before/after
      tree diffs so pre-existing dirty changes are excluded.

## 2. Safe undo service

- [x] 2.1 Implement exact reversal plus three-way inverse merge for modified,
      added, deleted, binary, and missing files.
- [x] 2.2 Preflight every affected file under a worktree lock and write nothing
      when any later/manual change conflicts.
- [x] 2.3 Create a private recovery tree before applying and roll back already
      written paths if a later write fails.
- [x] 2.4 Add tRPC contracts for response change sets, stored review diffs, and
      Undo results with explicit conflicts.

## 3. Transcript and Review UI

- [x] 3.1 Replace completed individual edit cards with a two-layer response card:
      one-line file count and aggregate `+/-` totals when collapsed; Codex-style
      header and file rows when expanded.
- [x] 3.2 Expose only `Undo` and `Review`; hide Undo for runs without recoverable
      before/after trees.
- [x] 3.3 Show three file rows before `Show N more`, with per-file `+/-` counts.
- [x] 3.4 Open a stored historical diff in Review and show conflict context when
      Undo is blocked.

## 4. Verification

- [x] 4.1 Add focused tests for exact reversal, non-overlapping later edits,
      overlapping conflicts, added files, and deleted files.
- [x] 4.2 Pass lint, Prettier, strict TypeScript, 49 test files/452 tests,
      production build, and strict OpenSpec validation.
- [x] 4.3 Restore Electron ABI 140, restart using `npm run dev`, and pass
      `npm run dev:verify` for this checkout and the Flapstack Dev profile.
- [ ] 4.4 Create a fresh post-change agent response that edits multiple files;
      visually verify collapsed/expanded states, stored Review, successful Undo,
      preservation of a non-overlapping manual edit, and conflict blocking for an
      overlapping manual edit.

2026-07-13 continuation evidence: authenticated MCP created isolated canonical
Git fixtures, read a stored two-file Review, reversed both files, preserved a
non-overlapping later edit, and rejected an overlapping edit without writes. It
also fixed canonical `/private/var` result paths. The fresh provider response and
visual collapsed/expanded/Review proof remain unverified, so 4.4 stays open.
The `ee39-ux` Dev profile subsequently passed `npm run dev:verify`, but macOS was
locked when the visual verification began. No manual UI evidence is claimed.

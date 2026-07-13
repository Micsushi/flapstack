# Change: Add safe agent-change undo and review

## Why

Agent file edits are visible in the transcript, but users cannot safely undo one
assistant response without risking unrelated manual work or changes from another
chat. The current checkpoints store hashes and aggregate manifests, not the file
content required for conflict-aware reversal.

## What Changes

- Persist private before/after worktree trees for each agent response/run so the
  exact response change set remains recoverable.
- Replace separate edit cards with one collapsed response-level changed-files
  card showing file count, total additions, and total deletions.
- Expose only two primary actions: `Undo` and `Review`.
- Make `Undo` reverse that card's exact changes while preserving cleanly
  mergeable later/manual edits.
- Fail closed on overlapping or unknown conflicts and open Review with the
  conflict instead of offering cascade or destructive overwrite actions.
- Reuse the Review surface for file and hunk inspection/revert.
- Create an automatic recovery snapshot before every successful undo.

## Impact

- Affected specs: `run-checkpoints`
- Affected code: checkpoint persistence, harness/tool event persistence, runs
  tRPC, git/change services, transcript edit rendering, review/diff UI, database
  schema and migrations
- Data: existing checkpoint JSON gains private recoverable tree identifiers;
  older rows remain review-only
- Safety: destructive writes become atomic, conflict-checked, and recoverable

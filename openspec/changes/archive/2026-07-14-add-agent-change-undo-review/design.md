## Context

Flapstack already records before/after run checkpoints and per-run manifests,
but checkpoint file entries contain hashes rather than recoverable content.
Multiple chats and manual editors may modify the same worktree concurrently.

Product/source review:

- Codex centralizes inspection in a Review pane and supports revert at entire
  diff, file, and hunk scope.
  <https://learn.chatgpt.com/docs/code-review#staging-and-reverting-files>
- Claude Code exposes one rewind concept from a message/checkpoint, but tracks
  direct file tools only; Bash and external edits are documented limitations.
  <https://code.claude.com/docs/en/checkpointing>
- OpenCode exposes one `/undo` plus `/redo` for a turn and uses Git snapshots.
  Its source collects turn patch parts for targeted reversal.
  <https://opencode.ai/docs/tui/>
  <https://github.com/anomalyco/opencode/blob/cf7503687a2485621a690d18c4b0d1ff2060bc3e/packages/opencode/src/session/revert.ts>
- 1Code exposes one rollback action on a user turn. Its current rollback restores
  a whole checkpoint tree and cleans untracked files, which is too destructive
  for Flapstack's shared-worktree/manual-edit case.
  <https://github.com/21st-dev/1code/blob/9f1bc76fa4372c18c565b5a4f8daf38ae3595f0e/src/main/lib/git/stash.ts>

## Goals / Non-Goals

Goals:

- One predictable Undo action per response-level changed-files card.
- Preserve non-overlapping later changes from other chats or manual editing.
- Block rather than overwrite when changes overlap or provenance is uncertain.
- Review the stored historical change set even after the worktree moves on.
- Support direct edit tools and command-caused file mutations.

Non-goals:

- Rewind conversation history.
- Automatically undo dependent later cards.
- Expose separate Undo All, Cascade Undo, or force-overwrite actions.
- Replace Git history, commits, or branches.
- Undo changes outside the selected worktree.

## Decisions

### One card, two actions

Each completed assistant response owns a two-layer changed-files card. Its
default collapsed state is one line:

`3 files changed  +42  -11                          Undo  Review`

Expanding shows the Codex-style detailed card: a header with the same aggregate
counts and actions, followed by file rows with paths and per-file `+/-` counts.
Long lists initially show three rows plus `Show N more`. Clicking a file opens
its stored change in Review. The transcript does not add per-file Undo buttons.
Review is the single advanced surface for file/hunk operations.

### Recoverable response trees

Each existing before/after run checkpoint also records a private Git tree commit
capturing tracked and untracked worktree content while leaving the user's index,
branch, commits, and files untouched. Private refs retain those trees. The diff
between the two trees is the response change set, including direct edit tools
and command-caused file mutations.

This uses the existing checkpoint and manifest rows. No new database migration,
per-tool ledger, stash application, or whole-tree restore is required. A
worktree-scoped lock serializes capture and undo.

### Merge-safe undo

Undo operates on the selected response's manifest paths.

1. Acquire the worktree change lock and refresh current hashes.
2. Read before/after content from the private trees and build every candidate
   result in a temporary area before writing.
3. If current content equals recorded after-content, restore before-content.
4. Otherwise perform a three-way inverse merge using current content as ours,
   recorded after-content as base, and recorded before-content as theirs.
5. If all files merge cleanly, write all results as one atomic operation with
   rollback-on-write-failure.
6. If any file conflicts, write nothing and open Review focused on conflicts.

This keeps non-overlapping manual or later-chat edits. It never silently rolls
back another card. Users who want to remove dependent later work undo the newer
card first, then retry the older card.

### Recovery and repeatability

Before applying a successful undo, create a private recovery snapshot containing
the exact current state of every affected path. The result records its recovery
identifier. Repeated Undo is idempotent and reports `already undone` rather than
applying twice. Recovery is available internally for error repair; no additional
primary transcript button is introduced in this change.

### Review behavior

Review accepts a stored response change-set identifier, not only the current Git
working diff. It shows the historical before/after diff, file tree, totals, and
conflict annotations. Existing current-worktree review remains unchanged.

## Risks / Trade-offs

- Full response trees cost Git object storage. Git deduplication stores unchanged
  blobs once; private checkpoint refs follow run-history retention.
- Binary and very large files may not support text merge. Exact after-hash
  matches can restore them; divergent files block and require Review.
- Provider-specific tool payloads may be incomplete. Response-tree capture is
  provider-independent and does not depend on those payloads.

## Migration Plan

- Existing runs keep their current manifests and remain review-only.
- New runs populate recoverable tree identifiers without a schema migration.
- UI hides Undo when recoverable step data is absent or incomplete.
- No existing checkpoint or manifest rows are rewritten.

## Open Questions

None. The intentionally conservative default is conflict -> Review, never force.

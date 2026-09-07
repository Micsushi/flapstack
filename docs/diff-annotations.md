# Diff comment authority

Diff Comments is a default-off beta contract. It stores draft comments in the
existing app database, scoped to one project and Chat. It does not stage, commit,
write repository files, or send an agent message. Desktop diff views provide
comment entry, editing, deletion and restoration. Remote-mobile authorization
and send-to-agent integration remain separate work.

An anchor contains the full SHA-256 of the observed uncommitted diff, relative
file path, old/new side, and inclusive line range. Creation and revision inspect
the current main-owned diff and reject mismatched identity, binary files and
lines outside loaded hunks. A rename or changed diff makes a comment stale;
only explicit revision can re-anchor it. Consumers must bind the hash to the
diff actually displayed, not just independently fetch a newer hash.

The desktop parsed-diff response uses full SHA-256 for both its cache protocol
and each displayed file's `observedDiffHash`. Locally/remote parsed patches without
that main-owned identity do not offer annotation controls. No Chat-specific scope
is stored in the shared worktree diff cache.

Use a file's Comment button or select lines and use the labeled gutter control.
The editor exposes start/end lines for keyboard input. While editing, selecting
a new comment location explicitly replaces the anchor while keeping the text.
Saving revalidates every selected line in main. Failed saves retain the draft and
creation UUID for retry; saved comments survive app restart. Unsaved editor text
is local to the mounted diff view, not a durable autosave.

Edits, deletion and restoration require the current comment version. Deletion
retains the draft for restoration. Creation uses a caller-generated UUID and
rejects reuse with different content. Comment changes and metadata-only records
in the existing audit trail commit in one transaction. Comment bodies are not
copied into audit summaries.

Create, edit, delete and restore register with shared Undo/Redo. Version conflicts
fail closed rather than overwriting a newer edit. Undoing an edit also requires
its previous diff anchor to remain valid; refresh/re-anchor if the worktree has
changed. Sending feedback is unavailable, and comments expose no sent state yet.

A retry of a committed create returns the latest draft without inspecting Git
or undoing later edits/deletion. Its freshness is unverified until the next list
refresh. This keeps a lost response recoverable after a diff change or disconnection.

Saved drafts remain readable with unverified freshness when the current diff
cannot be inspected. Creation and revision still fail closed. Delete/restore
operate on the scoped draft and do not require an online worktree.

Limits: 16 KiB UTF-8 per comment, 1,000 consecutive lines per anchor, 1,000 stored
comments per Chat including deleted drafts, and an 8 MiB collected diff before
annotation parsing. This reuses the existing Git diff collector; it does not yet
provide streaming process-output bounds or large-diff acceptance. No persistent
content index, automatic relocation, agent permission bypass or alternate audit
system is introduced.

Migration `0060_durable_diff_annotations` is additive. Tests exercise real Git
diffs without changing their files, database reopen, stale/renamed anchors,
version conflicts, root replacement, scope and UTF-8 limits, reversible deletion,
audit rollback and the disabled service gate.

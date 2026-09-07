# Diff comment authority

Diff Comments is a default-off beta contract. It stores draft comments in the
existing app database, scoped to one project and Chat. Saving drafts does not
stage, commit, write repository files, or send an agent message. Desktop diff
views provide comment editing, restoration and selected feedback sending.
Remote-mobile authorization remains separate work.

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
fail closed rather than overwriting a newer edit. Consecutive local actions share
their latest version so Undo/Redo can traverse the local sequence; an independently
changed version does not gain that authority. Undoing an edit also requires
its previous diff anchor to remain valid; refresh/re-anchor if the worktree has
changed. Sending feedback is not an Undo action; cancellation does not revert edits.

A retry of a committed create returns the latest draft without inspecting Git
or undoing later edits/deletion. Its freshness is unverified until the next list
refresh. This keeps a lost response recoverable after a diff change or disconnection.

Saved drafts remain readable with unverified freshness when the current diff
cannot be inspected. Creation and revision still fail closed. Delete/restore
operate on the scoped draft and do not require an online worktree.
Displayed diff identity also controls freshness immediately, even while a saved
comment query is cached. Refresh remains available after a metadata lookup failure
and retries project resolution before enabling scoped writes.

Limits: 16 KiB UTF-8 per comment, 1,000 consecutive lines per anchor, 1,000 stored
comments per Chat including deleted drafts, and an 8 MiB uncommitted-review
collection budget shared across status, filenames, diff output and diagnostics.
Each Git stdout/stderr stream is capped at the remaining budget; an overflow or
30-second collection deadline returns an error, never a partial successful diff.
The main review and annotation paths share this collector. Git external diff and
text-conversion drivers are disabled, with no shell or optional index refresh;
this is not an OS sandbox or user-cancellable large-diff acceptance. Branch/base
comparison retains its separate existing collector. No persistent
content index, automatic relocation, agent permission bypass or alternate audit
system is introduced.

Migration `0060_durable_diff_annotations` is additive. Tests exercise real Git
diffs without changing their files, database reopen, stale/renamed anchors,
version conflicts, root replacement, scope and UTF-8 limits, reversible deletion,
audit rollback and the disabled service gate.

Internal feedback foundation (`0061_durable_diff_feedback`) atomically records a
selected-version batch, one visible user message, a pending run and metadata-only
audit. It performs no provider dispatch itself. UUID retries return the original
batch after restart or loss of worktree access; changed selections fail. Each
batch permits up to 25 comments and a 512 KiB serialized prompt. Comment bodies
are preserved as JSON-encoded review data, without generation or rewriting.

Migration `0062_feedback_sent_state` records the last queued batch/version on each
comment without changing its edit version. Existing batches are backfilled by
highest comment version, then latest batch timestamp/ID. Scoped list reads join
only referenced batches to live run status; mutation responses require a list
refresh for status. Saved feedback identity remains readable while Git is offline.
A new batch UUID cannot queue the same comment version again, even after run
failure/cancellation or removal. Revise the comment explicitly before sending
again; there is no automatic provider retry. Original UUID retries still return
their batch while it exists. Removing a run clears its batch reference but retains
the sent version. Run, transcript, batch, sent markers and audit roll back together.

Completed direct-runtime feedback answers are projected into their conversation
from validated activity records. The idempotent assistant fallback inserts the
answer before a later user turn instead of appending it after queued feedback.
Native routers keep their existing transcript persistence.

Local-model feedback uses the same queue after scoped native adoption checks.
Its durable prompt, frozen launch settings and response order are preserved;
newer Chat preferences are not overwritten. A real SQLite feedback-batch to queue
claim to local-router test covers one successful mocked-provider response and
an idempotent retry. Installed Ollama and live-model acceptance remain unverified.

Desktop Send feedback binds to the active conversation in the view's scoped store.
The target and selected count remain visible. Only current, undeleted, unsent
versions are selectable. Before sending, the renderer stores the exact UUID,
scope, target and selected versions in local storage (no bodies). A failed response
keeps that request across remount/reload; Retry uses the original target even if
navigation changed the current conversation. Storage failure blocks sending.
Clear retry discards only local retry metadata and does not cancel queued work.

The default-off beta applies to both send and cancellation routes. Cancellation
resolves a run from the owned batch rather than accepting a run ID from the UI;
archived work can still be stopped. Existing runtime authority handles the stop.
The UI shows queued version and live run status, and warns that target permissions
may permit file edits and cancellation cannot undo them. Committed mutations and
terminal runtime events refresh split metadata/transcript/review queries.

Focused tests cover real database transactions, main/runtime and native provider
fixtures, disabled-beta routes, scoped cancellation, UI retry/remount and storage
failure. Isolated Chromium checks cover desktop and narrow layouts using a mocked
transport. Live provider, remote-mobile authorization and full end-to-end acceptance
remain open; these changes do not complete S7-F3-T2 or promote its Tier 2 checkbox.

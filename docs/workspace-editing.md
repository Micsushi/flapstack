# Workspace editing authority

The Workspace Editing beta is off by default. Its desktop API currently supports
existing UTF-8 text files in a connected chat worktree: read, compare-and-save,
history and reversal. Editable panes, autosave UI, rename and save-as are not yet
implemented. Existing text and Markdown viewers remain read-only.

Each save requires a project/chat scope, relative path, exact SHA-256 of the
opened bytes and a fresh operation UUID. The main process checks ownership,
archival, registered root identity and chat permissions before writing and again
at commit. Read-only and denied custom policies reject edits; ask-before-edits
requires an explicit Save and rejects autosave. Ordinary automatic-edit and
full-access modes remain confined to the registered worktree for this API.

Text is limited to 2 MiB, preserving BOMs, Unicode and line endings. Binary bytes,
invalid UTF-8, lossy Unicode drafts, traversal and symlink escapes are rejected.
A stale or missing target returns a conflict without replacing the draft or
disk contents. Main-process editor saves are serialized by canonical root;
external changes also pass the portable rooted writer's content checks. These
checks are not an OS sandbox against continuous namespace races.

Migration 0063 stores a prepared record before touching disk. Atomic replacement
and the existing redacted audit transaction complete the save. An audit failure
attempts safe file rollback. A retry after interruption reconciles prepared
metadata against disk without writing historical bytes.
Changed, missing or unreadable recovery targets remain explicit conflicts rather
than being reported as a verified failed write. Such records do not block other
files in the same worktree.

A repeated UUID returns
its recorded outcome rather than running the write again; changing its request
is rejected. Undo creates an inverse save, and reversing that save supplies redo.
Both still require the exact current bytes and a valid root and permission scope.
An undo retry resolves its own operation before consulting retained source text,
including interrupted inverses whose source snapshot has since expired. Duplicate
requests share the root lock through recovery and finalization.

History reserves at most 1,000 retained snapshots and 64 MiB of before/after text
per profile. Reserving a new operation expires oldest finalized snapshots as
needed, even if that new operation later fails. Prepared recovery records are
never expired automatically. Expired records retain identities, hashes and
outcomes for retry safety, but no source text, and cannot be undone. Metadata and
audit retention are separate from this snapshot-byte limit. The latest reversal
can reserve space by expiring older snapshots rather than failing solely because
ordinary history is full.

Focused coverage is in `tests/workspace-editing.test.ts` and
`tests/beta-feature-gates.test.ts`. Database-close tests model interrupted writes;
an isolated Node child also exits after the file commit and before journal
completion, then the reopened service recovers the prepared operation. The
fixture passed on Windows, Linux and macOS. This is not an Electron app-crash or interactive
editor walkthrough. S7-F4 acceptance remains open.

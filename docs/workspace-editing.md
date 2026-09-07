# Workspace editing authority

The Workspace Editing beta is off by default. Its desktop API currently supports
UTF-8 text files in a connected chat worktree: read, compare-and-save,
save-as to a new path, same-directory rename, history and reversal. Connected
chat text viewers now support durable drafts, explicit Save, disk review and
shared file undo/redo. Unbound viewers, Markdown/image previews and beta-disabled
viewers remain read-only. Autosave is opt-in per editor; full conflict recovery
UI remains unfinished.
The compare-and-save authority subtask (S7-F4-T1) is accepted independently of
those unfinished editor surfaces.

Migration 0066 adds the draft API foundation: `openDraft`, `updateDraft` and
`releaseDraft`. Buffers are stored per chat and canonical file path, separately
from the file-write journal. Opening or updating a draft never writes the file.
Reopening an existing file preserves unsaved text and reports a changed disk
digest as a conflict. A mounted owner may persist its buffer after the file is
removed, but missing-file reopen/export, draft discard and
missing-file recovery controls are not implemented yet.

`listDrafts` exposes a bounded metadata-only recovery list; `readDraft` retrieves
one stored buffer. These read-only APIs work after source-file deletion or edit
permission revocation, without acquiring or releasing an editable lease. They
still require the original active project/chat and registered root identity.
Root replacement and archival remain explicit access failures; stored buffers
are not deleted. These APIs do not reconcile pending saves or modify disk.

Migration 0067 adds `saveDraft` and pending-save recovery metadata. Saving requires
the live lease, exact draft revision, operation UUID and current permission.
It uses the same audited compare-and-save journal as ordinary saves. Successful
saves advance the buffer's base digest without discarding its text. Repeating a
save UUID returns its recorded outcome without rewriting the file; repeating an
acknowledged buffer update likewise does not increment its revision again.

After interruption, reopening reconciles pending metadata against the journal
and disk, never replays a file write. External changes stay conflicts and retain
the buffer. If the journal outcome has expired, recovery does not guess whether
the save applied: pending metadata remains and another save is blocked until
explicit recovery is available. A saving lease cannot be released or replaced,
even if its window closes, until the in-flight operation finishes.

The main process derives window identity from trusted IPC context. It permits
one live editable lease per file across windows, including case and hard-link
aliases. A new mount in the same window gets a fresh token; delayed updates and
releases from an older mount cannot affect the new lease. Closed windows are
pruned when another editor opens. Draft revisions reject stale updates, and
permissions plus registered root identity are rechecked before persistence.
Leases are process-local and do not survive application restart; buffers do.
File identities use bigint device/inode values serialized as decimal strings;
Windows inode values above the safe-integer range must not merge distinct leases.
The shared rooted-file authority also keeps bigint identities through root,
parent, target, descriptor and rollback checks. Synthetic adjacent 64-bit identity
races exercise all supported file actions, independently of the host filesystem's
current inode allocation.
File-discovery scans and local-model directory reads use the same exact-ID rule.
Git-exclusion snapshots and lock cleanup retain bigint identities too, so a
rounded-equal replacement cannot be mistaken for an owned lock or snapshot.

Each buffer is limited to 2 MiB of strict UTF-8. Draft storage separately allows
at most 1,000 buffers and 64 MiB of text, with at most 64 live leases. Reaching a
limit fails visibly without expiring saved buffers. Releasing a lease does not
delete its buffer. These APIs and the editable Monaco panes remain behind the
off-by-default beta.

## Text pane behavior

Typing persists the buffer separately from disk. Save (or Ctrl/Cmd+S) flushes
pending text before requesting a conflict-checked file write. Acknowledgements
never replace newer typing. Interrupted requests retry the same revision and
operation UUID. A failed buffer update prevents the pane's Close action; an
unacknowledged buffer also requests the browser's unload confirmation.

Autosave is off when an editor opens. Where the main process permits automatic
edits, opting in arms a 750ms quiet-period debounce only after subsequent typing.
It never writes an existing/recovered buffer merely because the editor opens,
the setting is enabled or its setting change is undone/redone. The setting is
shared by matching panes and participates in shared undo/redo. Turning it off
or releasing the last view cancels pending timers and queued automatic writes;
an already in-flight save finishes. Reopening a released editor starts with
autosave off. Explicit Save cancels its pending automatic timer.

Ask-before-edits reports autosave unavailable. Every automatic write still checks
current main-process permissions and disk content, regardless of the capability
reported when opening. Conflicts and failed/uncertain requests stop automatic
writes; no background retry loop resolves them. The buffer stays available for
explicit retry/review. Autosave uses the same journal and file undo as Save.

Panes for the same chat/root/path share one renderer session. Navigation releases
the lease after persistence; reopening restores the durable buffer, not a fresh
disk preview. Failed persistence retains the in-memory session for retry. File,
chat and editable/read-only transitions use separate Monaco models so preview
replacement cannot fire an old draft callback. Local editor undo history does
not survive those model transitions; durable text does.

Watcher events refresh disk evidence without replacing text. Changed or missing
disk content disables Save and offers a separate disk review. This first surface
offers **Replace reviewed version** for an existing readable file: it explicitly
saves the draft against the digest currently displayed in disk review. Another
external change rejects that replacement. The reviewed digest is bound into the
operation's retry identity and pending recovery metadata; autosave cannot use it.
The journal retains the reviewed version for undo. Child-process interruption
tests cover this path both before journal completion and after commit, including
later external edits; reopening never replays the replacement.

The surface does not yet offer reload/rebase, Save As, draft discard, missing-file export or
ownership reacquisition after another window takes a lease. Shared file undo/redo
uses the audited reversal API and refreshes disk evidence; it never discards a draft.

Renderer verification covers delayed/lost acknowledgements, coalesced typing,
shared pane lifetimes, unload protection, retry-safe undo/redo and Monaco's stale
read-only callback transition. An explicitly headless local browser fixture
exercised actual Monaco typing, Save, external-write conflicts, pane reopening,
beta toggles and NUL rejection at desktop and 390px widths. Its IPC/disk seam is
simulated, not evidence of full Electron IPC or native-device integration. Rapid
model disposal emitted one Monaco cancellation diagnostic; draft assertions passed.
The subsequent reviewed-replacement fixture passed with one recorded write and
no browser errors. Invalid-input rejection also restores the exact visible buffer
when Monaco undo groups earlier valid typing with the rejected input.
Fake-clock tests cover debounce, new-typing-only activation, disable/close fences,
shared ownership and failure suppression. The actual headless Monaco fixture
also verified no write on opt-in, one write after typing, cancellation on close,
reopening with the retained text and autosave off, and visible controls at 390px.

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

Save-as requires a missing destination in an existing directory. It never
overwrites an existing target or creates parent directories. Migration 0064
distinguishes file creation/removal from an empty file and preserves permission
bits for redo. Undo of creation removes only matching text; redo requires the
path to remain missing. Failed removal finalization attempts restoration only
into that still-missing path. External recreations and root changes are preserved.
This inverse API is not a general-purpose delete endpoint. Filesystem ACLs and
extended metadata are not journaled; new files use private permission bits.

Migration 0065 records both rename paths. Text renames exclusively create a
same-inode destination link before unlinking the verified source, so a concurrent
destination cannot be overwritten. Both names can briefly exist. An interruption
in that interval leaves an explicit conflict and preserves both names; recovery
does not guess which to remove. Finalized renames reverse only while source and
destination checks still hold. Filesystems without hard-link support fail without
an overwriting fallback. Case-only renames verify exact directory-entry spelling
before using a native rename of the single aliased entry. Exact-name scans are
bounded at 10,000 entries and fail visibly above that limit. Recovery distinguishes
the old and new spelling even on case-insensitive filesystems. Generic file-tree
directory renames are outside this beta authority.
Ordinary file-tree regular-file renames share the exclusive-link helper;
symlink and directory moves retain their existing platform implementation and
are not covered by the new no-overwrite guarantee.

History reserves at most 1,000 retained snapshots and 64 MiB of before/after text
per profile. Reserving a new operation expires oldest finalized snapshots as
needed, even if that new operation later fails. Prepared recovery records are
never expired automatically. Expired records retain identities, hashes and an
explicit expired state for retry safety, but no source text, and cannot be undone.
Metadata and audit retention are separate from this snapshot-byte limit. The latest reversal
can reserve space by expiring older snapshots rather than failing solely because
ordinary history is full.

Focused coverage is in `tests/workspace-editing.test.ts` and
`tests/beta-feature-gates.test.ts`. Database-close tests model interrupted writes;
an isolated Node child also exits after the file commit and before journal
completion, then the reopened service recovers the prepared operation. The
save/create/remove and rename fixtures, including interrupted link/unlink and
case-only rename, passed on Windows, Linux and macOS at `f3382bdf`. The broad
automated gates passed on all three systems. Isolated hidden Electron startup,
long-chat, search and four-pane probes also passed on Windows and macOS using
that exact candidate. Their temporary profiles and renderer processes were
removed, shared configuration fingerprints stayed unchanged, and Node ABI 127
was restored after Electron ABI 140 verification. These probes do not constitute
an Electron app-crash or interactive editor walkthrough. S7-F4 acceptance remains
open; Linux Electron startup remains blocked by the unconfigured sandbox helper.

The follow-up viewer portability checkpoint `a25a4f9e` passed broad gates on all
three platforms. Its image-viewer interaction fixture recorded unchanged Windows
drive/UNC targets and correctly joined relative targets without launching an
external editor. At narrow width, the editor action retains its accessible name.
Windows basenames and special-file language detection share the portable path
classification; literal POSIX backslashes remain filename characters. The macOS
native-watcher integration test has shown intermittent one-second event failures;
diagnostic timestamps/raw events are retained on future failures. Two subsequent
broad runs passed, but the intermittent cause is not claimed repaired.

Save/recovery checkpoint `0c2f4697` passed Windows and Linux broad gates, including
4,158 Windows main tests plus 11 platform tests and 4,166 Linux tests. Both
production builds passed. Mac SSH became unreachable before that checkpoint's
verification could start; its last complete broad/native evidence remains at
`6084d5e7`. No current interactive editor walkthrough is claimed.

# Portability and Private Sync

Flapstack can export selected local state into a readable directory ending in
`.flapstack-export`. The bundle is for backup and transfer. Private sync is a
separate, explicit workflow for safe file-backed scopes in a user-owned git
repository.

## Bundle contents

- `manifest.json`: format version, app version, selected scopes, project filters,
  dependencies, and fixed paths.
- `database/flapstack.sqlite3`: portable selected records built from one
  consistent SQLite backup. It is not a copy of the live database.
- `scopes/<scope>/`: selected safe text files plus a target index.
- `exclusions.json`: categories and logical paths for excluded credentials,
  tokens, sessions, webhooks, private keys, unsupported files, and user
  exclusions. Secret values are never written to this report.
- `checksums.json`: SHA-256 and byte length for every other bundle file.

WAL/SHM files, credential tables, unsupported unfiltered rows, machine-local
paths, symlinks, unsafe portable paths, and non-text file content are excluded or rejected. Structured
secret fields become a non-secret placeholder. Text uses the same scanner for
export and private sync. False-positive overrides use a candidate SHA-256 only;
the override does not store or report the candidate value.

## Export

Open Settings, then Portability & Sync. Select scopes and, when useful,
projects. Dependencies are added deterministically. Choose a new directory name
ending in `.flapstack-export`, then export. Cancellation and any failure remove
the incomplete directory.

The Settings file scope includes Flapstack-owned non-secret settings. The
Extensions file scope currently uses the writable `.agents` compatibility root.
Project vault files keep project identities and relative paths. Database-backed
scopes use selected records and never use git live sync.

Project filtering uses explicit per-table relationships, including the parent
`projects.id` row and dependent tasks, vault metadata, chats, attachments, and
voice metadata. History portability is database metadata only. Attachment and
voice file paths are excluded with category-only `local-path` evidence; the
bundle does not claim their machine-local binary files.

## Import and recovery

Every import first verifies the manifest, complete file set, checksums, scope
versions, dependencies, paths, and portable database. Dry-run results persist
under the Flapstack data profile and show create, update, conflict, and skip
decisions. There are no implicit deletes.

Source-machine project and vault paths are placeholders, never live target
paths. Dry-run uses explicit reviewed mappings plus existing current registered
project or vault destinations. A stale or missing registered vault root is never
reused; it produces a non-destructive mapping requirement with a nullable target
preview. Unrelated mappings are rejected. Duplicate mappings and multiple files
converging on one destination fail before apply. Project roots
must already be verified directories. Missing extension and vault roots may be
created under a verified non-symlink parent only during confirmed apply.

Conflicts require an explicit choice: keep local, use incoming, or preserve
both. Preserve-both keeps the local value live and writes both actual database
values or both file byte versions into the operation conflict-artifact folder.
The dry-run UI shows redacted local and incoming previews and reports the
artifact location after apply. Apply re-verifies the bundle fingerprint and live
diff. If either changed, Flapstack refuses the stale plan.

Apply admits no new database operations, drains already admitted app requests,
automation/task/orchestration/MCP work, schedulers, and the external usage daemon,
then closes the singleton before final revalidation. Cross-process owner/access
markers use a canonical database identity; crash orphans are removed only when
the recorded process is provably dead or its start identity proves PID reuse.
The database is always reinitialized in `finally`. Apply creates a full pre-import
database backup and a strict journal before publishing files. Every database and
file backup is bound by SHA-256, bytes, device, and inode, and recovery also requires
the expected active profile database path. Replaced backups fail before restore.
File swaps are atomic. Database writes use
one immediate transaction in declared scope/table order with foreign keys
enabled, deferred during the ordered insert, and checked before commit.
Failures restore file backups; a failure after database commit also restores
the database backup, including the commit-before-journal persistence window.
Startup checks incomplete journals before database
initialization and rolls them back. Settings exposes manual restore and recovery
actions with destructive confirmation.

## User-owned private git sync

Private sync supports only registry scopes marked safe after secret scanning.
Linking records a local repository, a credential-free remote URL, one branch,
and exact included paths. Flapstack never stores git credentials.

Each pull, commit, and push has two steps:

1. Fetch one reviewed remote object, then preview exact incoming/outgoing commit
   ranges, paths, old/new blob IDs, local/remote OIDs, divergence, conflicts,
   and the shared exact-blob secret scan result.
2. Confirm that exact preview fingerprint.

Pull accepts only a clean fast-forward to the exact reviewed fetched OID; it
does not refetch after confirmation. Commit stages only approved scope roots.
Push rechecks the reviewed remote OID and sends the exact reviewed local OID.
Any commit touching an unapproved path or containing a secret blob is rejected,
including intermediate outgoing blobs with a clean worktree. Force push, automatic commit/push,
database/history live sync, hosted relay, and silent fallback are not supported.

Private sync review is intentionally bounded to 64 commits, 256 changed paths
per commit, 2,048 total changed paths, 4,000,000 bytes per scanned blob, and
16,000,000 total scanned blob bytes. Diff output is also capped before parsing.
Split or squash larger private histories before reviewing them.
Unlink removes only Flapstack's link metadata; it does not delete the repository.

## Verification and limits

Import verification is deliberately bounded: an individual portable file is
limited to 64 MiB, all declared bundle content to 512 MiB, the portable SQLite
database to 256 MiB, and a bundle to 20,000 database records. Each encoded
identity or row is limited to 1 MiB, aggregate record JSON to 64 MiB, and the
persisted reviewed import plan to 15 MiB. File checksums use streaming reads;
database rows are preflighted for count and byte bounds and then iterated. Split
larger history transfers into multiple selected exports.

Focused tests cover contract validation, secret categories, relational filtered
export, local-path removal, deterministic export, cancellation, tampering,
clean-profile target mapping, redacted conflict previews, materialized
preserve-both artifacts, stale plans, five rollback fault windows, lifecycle
resume, FK ordering/check/rollback, settings pagination/confirmations, and exact
local-bare-remote incoming/outgoing path/OID/blob enforcement.

Real clean-profile restore, packaged macOS preview, Windows/Linux packaging, and
the consolidated visual/accessibility walkthrough remain release evidence and
must not be inferred from headless tests.

# MCP configuration undo

Settings records confirmed MCP changes in the same Undo/Redo history as other app
actions. Claude add, edit, enable/disable and delete are reversible. Codex supports
add and delete; editing and toggling remain unavailable. External/plugin-managed
configuration stays read-only. Authentication, logout and connection state are not
configuration undo actions.

History keeps only opaque receipt IDs in the renderer. Exact entries, field
absence and protected credential snapshots stay in the main process. Undo and
redo refuse an intervening change to the affected Claude entries or credentials.
Unrelated Claude settings are retained. Codex restores exact config bytes, so any
intervening edit to that file, including unrelated settings, causes a conflict.
Refresh and resolve the conflict before retrying; no conflicting data is discarded.

A failed reversal remains in history for retry. A confirmed reversal advances
history even when discovery fails; Refresh MCP servers retries discovery without
repeating the write. Removing configuration does not revoke a Codex OAuth grant.

Receipts last only for the main-process session, with limits of 100 MCP receipts
and 32 MB. Configuration files and affected credential snapshots are limited to
1 MB each. Expired receipts report that undo is unavailable. This is not a backup
or a crash-safe transaction across the config and credential files. A failed
credential rollback is retained in memory and retried before another undoable MCP change;
keep the app open while recovery is pending.

Codex prepares a version-checked `config/batchWrite` through its existing protocol
client in a private temporary home, with no account credentials copied and no
thread, MCP connection or OAuth request. Temporary config files have restricted
access and are removed before publishing the edit. An abrupt process exit can
leave that temporary directory behind. Unsupported config APIs fail without
changing the original file. Final writes compare the original bytes immediately
before replacement; external programs do not share the app's write mutex.

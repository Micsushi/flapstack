# Workspace file discovery

File suggestions search registered workspace roots only. Concurrent requests for
the same canonical root share one scan. Completed results are cached for five
seconds, with at most 20 cached roots and 20 active scans.

Cancelling a request stops waiting immediately. The shared scan continues only
while another requester needs it; cancelling the last requester releases the scan
and prevents its results from entering the cache. Clearing the cache also
invalidates an active scan, so a later request cannot receive its stale results.

Discovery does not follow symlinks. It checks root identity before returning and
bounds traversal to 15 directory levels, 20,000 visited entries and ten seconds.
Unreadable directories, changed roots and exceeded limits are errors, not
successful empty results. A failed or cancelled scan can be retried immediately.
Existing dependency/build-directory and file-extension exclusions still apply.

This is the bounded filesystem fallback, not the complete S7 Quick Open feature.
The file dialog exposes discovery failures with an accessible alert and retry
action instead of reporting no matches. Loading has a separate status, and old
query results are not reused while another query loads. The dialog remains
centered at narrow viewport widths. Streamed result delivery, ripgrep discovery
and the unified provider UI remain separate work. No persistent search index is
introduced.

Recent-file lookup accepts Windows drive and UNC paths with mixed separators and
casing, without crossing a neighboring root/share boundary. POSIX path casing
and literal backslashes remain distinct. Matching recent entries appear once;
removal clears their Windows aliases without deleting a file. The named removal
button supports keyboard activation without opening the result and participates
in the shared Undo/Redo history. Undo preserves unrelated files opened meanwhile.

Regression coverage lives in `tests/files-router-path-safety.test.ts`, including
shared queries, cancellation, invalidation, unreadable roots and depth limits.
Recent-path and reversible-action checks live in `tests/file-search-paths.test.ts`
and `tests/file-search-recent-actions.test.tsx`.

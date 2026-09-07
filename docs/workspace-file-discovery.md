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
centered at narrow viewport widths. No persistent search index is introduced.

Enable **Streamed File Search** in Beta Features to receive partial file results
in the file dialog. It defaults off. Streams share the existing scan/cache with
ordinary queries, carry a unique request identity, and stop receiving events
when superseded or closed. One remaining consumer keeps a shared scan alive.
At most 20 streams are active; progress is rate-limited to ten updates per second
plus the final result. Directory identity is checked before publishing entries.
Partial results remain visible with an error if discovery fails; Retry starts
fresh work. Ripgrep discovery and unified cross-provider Quick Open remain open.

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
Stream identity, retry and disposal are covered by `tests/streamed-file-search.test.tsx`.
Keyboard selection follows file identity when partial batches rerank results.
If a selected file leaves the capped results, selection returns to the first row.
`tests/file-search-stream-selection.test.tsx` exercises both cases through the dialog.

## File read limits

The text preview accepts up to 2 MiB and the binary preview up to 20 MiB.
Rooted reads enforce the caller's byte cap while reading, not just when checking
the initial file size. A file that grows beyond its cap is rejected after at
most one additional byte; it is not loaded fully or silently truncated. Reads
without an explicit cap retain their existing behavior. Growth and exact-boundary
regressions are covered by `tests/rooted-read-bounds.test.ts`.

Plan-file reads also enforce the 2 MiB text limit while reading, including files
that grow after their initial size check. A successful empty plan replaces the
cached text; it is not treated as a missing response. Both details-sidebar plan
views cover that transition in `tests/plan-content-cache.test.tsx`.

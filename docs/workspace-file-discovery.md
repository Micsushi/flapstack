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
Streamed result delivery, ripgrep discovery and the unified provider/error UI
remain separate work. No persistent search index is introduced.

Regression coverage lives in `tests/files-router-path-safety.test.ts`, including
shared queries, cancellation, invalidation, unreadable roots and depth limits.

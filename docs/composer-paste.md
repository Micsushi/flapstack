# Composer paste

Right-click Paste is an explicit text-paste action. In the desktop app it uses
the existing preload clipboard bridge; browser-only surfaces use the browser
clipboard API. Failure is visible instead of silently ignored.

The menu dispatches the same paste event as the keyboard path. Existing undo
snapshots, plain-text insertion, large-text attachment handling, and inline size
limits therefore apply to both. A saved selection is restored only when both
ends still belong to the composer. Removed or disabled editors reject late
clipboard results. Clipboard contents are never logged.
Failed attachment writes explicitly report that no text was added and leave the
clipboard unchanged for another attempt.
Undo skips a debounced snapshot matching the current content, so the first
shortcut restores the previous content. Undo/redo also cancels pending snapshots.

The menu remains text-only; image clipboard handling uses the existing keyboard
paste path. Tests use synthetic clipboard data, including the real composer in
an isolated Chromium fixture, and do not read or modify the user's clipboard.

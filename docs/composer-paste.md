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

## Saved attachments

Removing an attachment from a draft leaves its saved copy in the chat's
Attachments tray. Use **View** there to preview saved text or images, even when
the chat has no worktree. Other file types show an unsupported-preview message.
Existing task artifacts that reference a file inside the current worktree still
open in the worktree viewer.

The tray's separate delete action asks for confirmation before permanently
removing a saved copy, including its shared task-artifact entry. It does not
remove copies already embedded in sent messages, attached to drafts, or written
to a worktree. Cancel leaves the copy intact. If deletion fails, the confirmation
stays open so you can retry.

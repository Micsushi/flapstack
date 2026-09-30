# Tasks

## 1. Implementation

- [x] 1.1 Add a `handoff` or equivalent full-history export format that returns
      complete, untruncated chat content for a whole chat by default.
- [x] 1.2 Add "Copy full chat history" to the left sidebar chat right-click menu
      and overflow menu, using the full-history format.
- [x] 1.3 Add an active-chat/menu action for copying the currently open chat's
      full history.
- [x] 1.4 Preserve current visible-conversation export behavior for the existing
      "Export chat" submenu.
- [x] 1.5 Show success and failure toasts for clipboard copy, including a clear
      failure message if the clipboard write fails.
- [x] 1.6 Add a copy action to each user-sent text message bubble.

## 2. Verification

- [x] 2.1 Add or update focused tests for the full-history formatter.
- [x] 2.2 Run targeted tests for chat export/copy behavior.
- [x] 2.3 Manually verify the sidebar right-click action and active-chat/menu
      action copy the chat's full visible conversation (plus clearly labeled
      legacy recovery content when hidden legacy rows exist).

2026-07-13 lane attempt: the isolated `ee39-ux` Dev profile passed
`npm run dev:verify`, but macOS was locked before Computer Use could inspect the
sidebar, active-chat menu, or clipboard result. Task 2.3 remains open.

2026-07-14 completion evidence: both the real sidebar menu path and active-chat
header path invoked the production clipboard bridge. Each returned the full
visible conversation, including the clearly labeled legacy recovery section;
the exact clipboard content was compared and restored after the check.

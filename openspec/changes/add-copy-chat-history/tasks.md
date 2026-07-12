# Tasks

## 1. Implementation

- [ ] 1.1 Add a `handoff` or equivalent full-history export format that returns
      complete, untruncated chat content for a whole chat by default.
- [ ] 1.2 Add "Copy full chat history" to the left sidebar chat right-click menu
      and overflow menu, using the full-history format.
- [x] 1.3 Add an active-chat/menu action for copying the currently open chat's
      full history.
- [ ] 1.4 Preserve current visible-conversation export behavior for the existing
      "Export chat" submenu.
- [ ] 1.5 Show success and failure toasts for clipboard copy, including a clear
      failure message if the clipboard write fails.
- [x] 1.6 Add a copy action to each user-sent text message bubble.

## 2. Verification

- [ ] 2.1 Add or update focused tests for the full-history formatter.
- [ ] 2.2 Run targeted tests for chat export/copy behavior.
- [ ] 2.3 Manually verify the sidebar right-click action and active-chat/menu
      action copy the chat's full visible conversation (plus clearly labeled
      legacy recovery content when hidden legacy rows exist).

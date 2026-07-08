# Change: Add full chat-history copy actions

## Why

Users often move work between Claude, Codex, and fresh chats by pasting a
handoff-style transcript. Flapstack already has chat export/copy utilities, but
the existing menu hides copy actions inside export formats and the context
helper truncates older messages, which is not enough when the user wants the
entire history copied quickly.

## What Changes

- Add a direct "Copy full chat history" action to chat context menus in the left
  sidebar.
- Add an active-chat/menu entry so the currently open chat can be copied without
  finding it in the sidebar.
- Add a handoff-oriented clipboard format that includes chat metadata, all
  sub-chats, all messages in chronological order, and concise tool summaries.
- Keep existing Markdown/JSON/Text download and copy options available for
  explicit export workflows.

## Impact

- Affected specs: chat-history-export.
- Affected code: chat export formatting in `src/main/lib/trpc/routers/chats.ts`
  and/or `src/renderer/features/agents/lib/export-chat.ts`; sidebar context
  menus in `src/renderer/features/sidebar/agents-sidebar.tsx`; active chat
  overflow/menu surface in `src/renderer/features/agents/main/active-chat.tsx`
  or adjacent toolbar components.

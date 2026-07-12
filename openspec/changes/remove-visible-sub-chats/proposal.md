# Change: Remove visible sub-chat structure

## Why

Flapstack presents a sidebar chat as a container that can hold additional
"sub-chats." This makes one chat appear to contain more chats and conflicts with
the intended user model: each chat item in the sidebar is one conversation.

## What Changes

- **BREAKING** Remove user-facing creation, navigation, switching, splitting,
  pinning, and archiving of sub-chats.
- Make each sidebar chat open exactly one visible conversation.
- Remove the active-chat `+` action and the clock/history quick-switch action.
- Keep global search in the left sidebar as the supported cross-chat search
  surface.
- Preserve existing local data by retaining the current `sub_chats` persistence
  record as an internal one-to-one compatibility implementation for now.
- When old data contains several sub-chats under one sidebar chat, preserve one
  visible canonical conversation and do not silently delete the others.

## Impact

- Affected specs: `single-conversation-chats`, `scoped-search`,
  `chat-history-export`.
- Affected code: active chat header and transcript composition, sub-chat store
  and routing, search-result navigation, split view, chat export, and focused
  tests.
- Existing chats and messages require a non-destructive compatibility policy;
  destructive database normalization is out of scope.

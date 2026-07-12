# Change: Add chat message timestamps

## Why

Users need to see when each user and assistant message was sent, especially
when returning to older conversations.

## What Changes

- Show timestamps beneath user and assistant messages.
- Show time only for messages from today.
- Show full local date and time for older messages.
- Persist timestamps on messages that did not previously carry one.

## Impact

- Affected specs: chat-message-timestamps.
- Affected code: message synchronization and transcript message actions.

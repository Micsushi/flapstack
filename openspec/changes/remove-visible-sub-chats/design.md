## Context

The inherited 1Code model stores conversation messages in `sub_chats`, while a
sidebar `chats` row holds scope, project/task, worktree, branch, permission, and
default provider metadata. The renderer exposes sub-chat tabs, a new-sub-chat
button, history/quick switch, split view, and direct sub-chat routing.

Flapstack's desired product model is simpler: one sidebar chat is one visible
conversation. Existing local profiles may already contain several sub-chats per
chat, so immediately deleting the table or collapsing rows risks message loss.

## Goals / Non-Goals

- Goals:
  - Present exactly one conversation for every sidebar chat.
  - Remove all normal UI routes that create or switch sub-chats.
  - Preserve existing messages and keep search navigation valid.
  - Minimize risk to current provider transports and run persistence.
- Non-Goals:
  - Delete or rename the `sub_chats` database table.
  - Rewrite all provider transports to store messages directly on `chats`.
  - Delete extra legacy sub-chats or merge their transcripts automatically.
  - Remove left-sidebar global search.

## Decisions

### Keep one internal conversation record per chat

New chats continue creating one internal `sub_chats` row because transports,
runs, messages, search, voice artifacts, and checkpoints currently reference
that ID. The row becomes an implementation detail rather than a user-visible
nested object.

Alternative considered: move messages and session state directly onto `chats`.
Rejected for this change because it creates a destructive schema migration and
touches every harness without improving the visible result.

### Select a canonical row without deleting legacy rows

For an existing chat with multiple internal rows, select the active row when a
valid persisted selection exists; otherwise select the earliest non-archived
row. Hide the remaining rows from ordinary chat UI. Keep their data intact for
a later explicit migration/export decision.

Alternative considered: promote every old sub-chat into a new sidebar chat.
Rejected because it would unexpectedly multiply and rename sidebar items.

### Remove nested navigation surfaces

Remove the top sub-chat tab strip, new-sub-chat `+`, clock/history quick switch,
split-view entry points, and nested sub-chat management actions. Search results
open the owning sidebar chat and its canonical conversation.

### Preserve full-history export compatibility

The pending full-history export may still include hidden legacy rows so old data
remains recoverable. For newly created chats, the export contains the single
internal conversation without presenting it as a nested chat hierarchy.

## Risks / Trade-offs

- Hidden legacy conversations remain stored but are not normally navigable.
- Some source and database names continue saying `subChat` until a later safe
  storage migration.
- Active Stage 2 work overlaps `active-chat.tsx`; implementation must preserve
  those uncommitted changes and use focused conflict review.

## Migration Plan

1. Add a shared canonical-conversation resolver.
2. Route active chat, search, export, and run state through that resolver.
3. Remove visible nested navigation and creation surfaces.
4. Verify old multi-row fixtures retain every database row and open one stable
   conversation.
5. Defer physical schema normalization to a separate approved change.

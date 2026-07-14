## Context

The inherited Kanban derives cards from chats and drafts. Flapstack's confirmed
contract is different: Kanban cards are real Stage 1 tasks. Plan source items are
read-only candidates until promoted. AI proposals remain inert until approval.

## Goals / Non-Goals

- Goals: readable plans, real task board, explicit promotion, one seeded chat,
  AI proposal approval, status/order sync, and conflict safety.
- Non-goals: a second task type, automatic agent launch, rewriting arbitrary
  plan files, full project management suite, or hosted collaboration.

## Decisions

- Fixed initial task states: `backlog`, `planned`, `in-progress`, `review`,
  `done`. Existing `active` migrates to `in-progress`; archived remains separate.
- Cards in normal Kanban columns always reference `tasks`. There is no
  `plan_items` table.
- Plan view parses repo OpenSpec plus explicitly selected Markdown documents.
  It is read-only in Stage 4; source editing uses the normal file/editor path.
- Parsed plan candidates have stable source fingerprints, not database identity.
  Promotion transaction creates one task plus one task-scoped chat and stores
  source provenance. It never launches a run.
- AI planning writes `task_proposals`, not tasks. The board has a separate
  proposal tray. Approval atomically creates the task/chat; rejection archives
  proposal evidence.
- Task ordering uses fractional/order keys per project/state with transactional
  rebalance. Version checks prevent stale drag overwrites.
- Plan source changes mark candidates stale; they never silently mutate created tasks.

## Risks / Trade-offs

- Existing Kanban terminology treats chats as workspaces. Replace data mapping,
  not broad unrelated UI naming.
- Parsing arbitrary Markdown is ambiguous. Only OpenSpec gets structural parsing;
  Markdown uses explicit headings/checklist extraction and exposes limitations.
- Drag is mutation. Show what task/chat/status will be created before promotion.

## Migration Plan

Migrate existing task `active` to `in-progress`. Existing chats remain chats and
do not become tasks automatically. Hosted-era Kanban drafts remain unimported.

## Open Questions

- None blocking. Plan view is read-only and columns are fixed for first delivery.

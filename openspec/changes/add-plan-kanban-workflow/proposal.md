# Change: Add Plan and Kanban workflow

## Why

Flapstack has inherited chat-derived Kanban UI and plan-message surfaces, but no
local-first workflow connecting project plans to durable tasks and scoped chats.

## What Changes

- Add canonical task workflow states/order and AI proposal records.
- Add read-only plan source discovery for repo OpenSpec and selected Markdown.
- Replace chat-derived Kanban cards with real project tasks.
- Promote a plan item into exactly one task and one seeded chat without auto-run.
- Add approval-gated AI proposals, conflict handling, and MCP planning tools.

## Impact

- Affected specs: new `plan-kanban` capability.
- Affected code: task schema/router, plan readers, inherited Kanban, project
  navigation, chat creation, MCP approval/audit, Settings, and tests.

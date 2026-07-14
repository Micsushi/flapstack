# Change: Add project knowledge vaults

## Why

Tasks and attachments hold transient context, but projects need typed durable
knowledge that survives chats and can be loaded intentionally by users and agents.

## What Changes

- Add a per-project knowledge vault with typed index, handoff, decision, context,
  task-note, and log sections.
- Default to app-managed central storage and require explicit opt-in before
  creating project-owned or git-tracked files.
- Add safe browsing, search, edit/conflict handling, backup/export, and restore.
- Add explicit section selection for run context and approved/audited MCP writes.
- Exclude secrets by default and reject or quarantine detected secrets.

## Impact

- Affected specs: new `project-knowledge-vaults` capability.
- Affected code: project schema/config, `project-vaults.ts`, filesystem safety,
  renderer project surfaces, context assembly, MCP registry/gate/audit, and search.

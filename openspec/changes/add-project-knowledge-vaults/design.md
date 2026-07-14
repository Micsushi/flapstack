## Context

`project-vaults.ts` already exposes a disabled section registry and scaffold plan.
The first delivery needs one deterministic default before that scaffold is enabled.

## Goals / Non-Goals

- Goals: durable typed knowledge, explicit loading, safe app/agent editing,
  search, backup, and strict secrets separation.
- Non-goals: a general Obsidian clone, credential storage, hosted sync, hidden
  memory injection, or automatic git commits.

## Decisions

- Store section metadata in SQLite and content as Markdown files so users retain
  readable, recoverable data.
- Default new vaults to app-managed central storage keyed by stable project ID.
  Offer a project-owned `.flapstack/knowledge/` folder only as an explicit
  per-project opt-in. Record tracking intent independently; never infer it from
  `.gitignore`.
- Use typed sections with stable IDs. Custom documents may be added, but secrets
  are a separate unsupported content class.
- Run context is opt-in by section and records source, size, and truncation.
- Writes use optimistic concurrency, atomic replace, backup, registered-root
  checks, and the Stage 3 approval/audit path for MCP mutations.

## Risks / Trade-offs

- Project-owned storage is portable but interacts with worktrees and git. Central
  storage is shared and clean but less portable. The fixed central default keeps
  setup deterministic while export and the project-owned opt-in preserve portability.
- Durable context can leak secrets or become too large. Add detection, explicit
  selection, budgets, redacted previews, and fail-closed injection.

## Migration Plan

This is additive. Existing task descriptions and attachments remain unchanged.
Disabling a vault stops injection but preserves content until explicit deletion.

## Open Questions

- None blocking. App-managed central storage is the default; project-owned
  storage and git tracking are explicit per-project opt-ins.

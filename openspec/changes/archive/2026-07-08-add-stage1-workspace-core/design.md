# Design

## Context

Flapstack inherited the 1Code codebase: Electron + tRPC + Drizzle/SQLite with
projects → chats → sub_chats and separate Claude/Codex launch paths. Stage 1
turns this into the Flapstack object model (global/project/task chats, unified
runs) while staying local-first. The goals and decisions below preserve the
product rationale needed for this archived change.

## Goals / Non-Goals

- Goals: tasks, chat scopes, unified run records, enforced permission modes,
  worktree defaults, persisted attachments, pin/archive, scoped search,
  checkpoints + manifests.
- Non-Goals: STT/TTS, MCP control surface, automation, local-model agent
  loop, skill manager, revert-by-run, hosted/sync infrastructure.

## Decisions

- Decision: extend the existing schema in place (nullable `chats.projectId`,
  new tables) rather than a new parallel model.
  Alternatives: new chat table with views - rejected as migration churn for
  no behavioral gain.
- Decision: permission inheritance is copy-on-create, never live-linked.
  Parent changes affect only future children. Alternatives: live resolution -
  rejected; runs must be reproducible and auditable.
- Decision: harnesses stay behind their existing routers; unification happens
  in shared types + a persisted `agent_runs` contract, not a rewrite of the
  launch paths. Alternatives: single abstract harness executor - rejected for
  Stage 1 risk.
- Decision: permission modes map to native harness controls (Claude SDK
  permissionMode/canUseTool; Codex sandbox/approval). Unsupported custom
  toggles are stored and surfaced as best-effort, never silently ignored.
- Decision: task chats default to one shared task worktree; project chats to
  the project checkout; global chats have no checkout unless assigned.
- Decision: checkpoints are git-state records (commit + porcelain status +
  content hashes), not stash mutations; no automatic revert in Stage 1.
- Decision: search uses SQL LIKE over existing storage including the
  `sub_chats.messages` JSON blob; message-table normalization is deferred
  debt.

## Risks / Trade-offs

- Nullable `projectId` is a SQLite table rebuild → verify the full migration
  chain on a copied database before touching real data (task A5).
- Claude/Codex permission surfaces differ → store requested mode, show what
  was actually enforced.
- LIKE-over-JSON search performance → acceptable at local scale; revisit
  with FTS5 when normalizing messages.

## Migration Plan

Small sequential drizzle migrations (tasks A2 → A3 → A4), each applied and
verified against a throwaway copy of the live DB; existing chats backfill
`scope='project'`; no message rewrites. Rollback = restore the pre-migration
DB copy (local-first, single user).

## Open Questions

- None blocking; per-task open points are recorded in this change's `tasks.md`.

# Change: Improve agent context and evidence quality

## Why

Provider chats currently receive a large repeated startup envelope, can treat
stale handoff text as current truth, and are not warned when repository-wide
claims require checking multiple worktrees. Claude can also continue the most
recent directory session for a brand-new Flapstack chat, while Cursor can
persist duplicated prose and anonymous tool events. These defects make capable
models less accurate and less auditable than their native harnesses.

## What Changes

- Add compact, session-aware startup context with explicit budgets and no
  model-authored context receipt.
- Add a read-only live Git/worktree preflight for repository status, progress,
  remaining-work, stage, branch, and worktree questions.
- Treat handoff and remembered context as leads that require live verification.
- Isolate provider sessions per Flapstack chat, beginning with Claude.
- Canonicalize Cursor text and tool events before display and persistence.
- Persist the context sources and repository evidence used by a run.
- Add controlled multi-provider quality fixtures and gates.
- Evaluate Codex App Server as the preferred native-quality Codex transport,
  retaining ACP unless the spike proves parity and safe migration.

## Impact

- Affected specs: new `harness-quality` capability.
- Affected code: shared harness launch context, Codex/Claude/Cursor/OpenCode
  adapters, run/message metadata, and provider fixture tests.
- Data: additive metadata only; no destructive migration.
- Security: Git inspection is read-only and remains scoped to the selected
  local project. Context and tool evidence continue to use existing redaction.

## Context

S4-F12 stores capability and presentation together in each profile version.
The Stage 5 model must reuse that implementation, not create profile/preset duplication.

## Goals / Non-Goals

- Goals: one clear Agent Profile chooser, reusable traits, Markdown ownership,
  exact versioning, new-chat/sub-agent reuse, speed compatibility, and immutable launches.
- Non-goals: treating personality as a skill, allowing tone to grant authority,
  mutable active agents, a hosted marketplace, or a second profile registry.

## Decisions

- Canonical terms: Agent Profile; Personality; Starter Profile. Preset is not an
  agent entity.
- Agent Profile owns capability: instructions, harness/runtime, model, skills,
  tools, permissions, reasoning effort, speed preference, memory/worktree, and descendants.
- Personality owns presentation only: reusable Markdown body plus frontmatter
  for name, tone, verbosity, formatting, response structure, labels, and color.
- Personalities have stable IDs, immutable versions, user/project scopes,
  provenance, archive state, import/export, and one optional base version.
- Profiles reference one exact personality version. Launch overrides may narrow
  presentation but cannot change capability.
- Existing embedded presentation migrates to a generated private personality or
  remains an explicit inline legacy personality until user conversion; history
  never rewrites.
- Launch stores resolved profile and personality content/digests. Later edits
  affect future launches only.
- New-chat, direct spawn, and workflow worker selectors resolve by stable ID and
  exact version, never display name alone.
- Speed preference is adapter/model capability-gated and never silently falls back.

## Risks / Trade-offs

- Shared personality edits can surprise users. Immutable versions and launch preview prevent drift.
- Markdown can contain hostile text. Import preview, secret scan, provenance,
  size limits, and no executable semantics are mandatory.

## Migration Plan

Add personality records/files and nullable personality reference. Preserve S4
profile versions and snapshots. Offer explicit conversion; rollback keeps inline
presentation readable and disables only new personality selection.

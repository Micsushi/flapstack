# Change: Add reusable agent profiles and personalities

## Why

Stage 4 can coordinate many agents and preserve each harness runtime, but users
still need a safe way to define who an agent is, what it may do, how it should
communicate, and where it can be reused. The same named agent should work as a
step inside a workflow or as a standalone agent launched from a task/chat
without personality text silently changing authority.

## What Changes

- Add versioned reusable agent profiles with separate capability, presentation,
  workflow-binding, and resolved-runtime layers.
- Let users create, duplicate, edit, preview, archive, import, and export local
  profiles without importing secrets or hidden authority.
- Allow workflow steps to bind an exact profile version and safe per-step
  overrides while preserving an immutable launch snapshot.
- Allow users to launch a standalone named agent from a task/chat using the same
  profile contract and normal Flapstack chat/run/workspace ownership.
- Add a small evaluated starter catalog of agent types while allowing users to
  make their own names, instructions, personalities, and specializations.
- Use the pinned Oh My OpenAgent and Everything Claude Code research to resolve
  routing, composition, trust, evaluation, and catalog-sprawl decisions before
  implementation begins.

## Impact

- Affected specs: new `agent-profiles` capability; orchestration operations and
  Agent Runtime consume immutable resolved profile snapshots.
- Affected code: profile schema/storage, Settings/Profile Studio, workflow
  definitions, standalone agent launch, permissions/skills/model resolution,
  import/export, activity/audit, evaluation fixtures, and operation workspaces.

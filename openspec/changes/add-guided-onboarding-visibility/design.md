## Context

Visibility is presentation policy, not capability authority. Stage 6 needs a
single registry so onboarding, navigation, Settings, search, and help agree.

## Goals / Non-Goals

- Goals: low-friction first run, reversible defaults, hidden-but-functional
  optional surfaces, reusable help, and safe existing-user migration.
- Non-goals: disabling APIs/MCP, deleting data, weakening safety, behavioral
  analytics upload, or permanently classifying users.

## Decisions

- Presets are onboarding visibility presets only; agent presets do not exist.
- Initial presets: Focused, Standard, and Complete. Users review exact surface
  changes before apply and can customize immediately.
- Core project/task/chat/run/worktree/permission/security/recovery surfaces are
  always discoverable and cannot be hidden by onboarding.
- Feature registry owns ID, label, description, category, default per preset,
  route/search keys, prerequisites, and always-discoverable status.
- Existing users initially preserve current visibility. The guide is offered,
  never auto-applied.
- Rerun previews a diff and changes visibility only; data and authority remain.
- Help copy is local, versioned product content reused across tutorial, Settings,
  empty states, and What is this popovers.

## Migration Plan

Add versioned visibility preferences and onboarding state. Existing profiles
receive an explicit preserve-current marker. Unknown future feature IDs use
their declared safe default and remain visible in Settings search.

# Change: Improve daily workspace control

## Why

Flapstack already runs and supervises agents safely, but account switching,
navigation, diff feedback, file editing, and terminal recovery still require
workarounds that interrupt the normal coding loop.

## What Changes

- Isolate Codex and Claude subscription/API credentials per managed account.
- Make active-account usage, switching, refresh, and run provenance consistent.
- Add unified Quick Open with typed failures and cancellation.
- Add structured inline diff comments that can be sent to an agent.
- Add conflict-aware editable files and richer repository previews.
- Preserve terminal state across renderer/app restarts and add terminal splits.
- Add rich Markdown round-trip, bounded large/image diff review, and terminal
  quick-command profiles.
- Add agent-aware Off, Automatic, and On sleep prevention with truthful status.
- Add sparse-checkout presets and evidence-driven reversible workspace cleanup.

## Impact

- Affected specs: new `daily-workspace-control` capability; existing usage,
  credentials, runtimes, permissions, checkpoints, saved workspaces, and mobile
  control are extended.
- Affected code: provider auth/account services, usage providers, run snapshots,
  file search/router/viewer, diff UI, terminal router/runtime/history, worktree
  sparse/cleanup services, power assertions, mobile projections, migrations,
  and tests.

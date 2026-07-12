# Change: Add safe MCP control of Flapstack

## Why

Agents can work inside Flapstack but cannot safely inspect or operate the app's
projects, tasks, chats, runs, files, and worktrees through one structured local
interface. Stage 3 adds that control surface with user authority intact.

## What Changes

- Add a local Flapstack MCP server and structured app-control tools.
- Add per-chat exposure and supported harness registration.
- Apply caller identity, permission tiers, approvals, and self-reference guards.
- Persist redacted audit history and expose it in the UI.
- Add approved Codex-to-Claude and Claude-to-Codex thread spawning.
- Add user-facing MCP status, controls, approvals, and safety feedback.

## Impact

- Affected specs: new `app-control-mcp` capability.
- Affected code: Electron lifecycle, MCP registry/transport, tRPC services,
  Drizzle schema, run/chat/task services, harness configuration, and renderer UI.

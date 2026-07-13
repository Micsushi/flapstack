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
- Keep the product app-control stdio MCP separate from the development-only
  authenticated HTTP test-control MCP already used for live diagnostics.
- Recover only interrupted MCP-origin runs after startup migrations and notify
  the renderer after child-process mutations.

## Impact

- Affected specs: new `app-control-mcp` capability.
- Affected code: Electron lifecycle, MCP registry/transport, tRPC services,
  Drizzle schema, run/chat/task services, harness configuration, and renderer UI.
- Related but separate capability: `add-dev-test-control-mcp` remains a
  development-only test surface and is not a transport or permission shortcut
  for this product capability.

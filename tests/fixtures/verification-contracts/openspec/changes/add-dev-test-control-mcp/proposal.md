# Change: Add dev-only MCP test control

## Why

Flapstack bug work currently depends on UI automation to inspect chats, launch
provider runs, answer approvals, and verify persistence. The existing dev test
control registry is only a tRPC-shaped scaffold and its prompt helper writes a
database message without exercising the real harness.

## What Changes

- Add an authenticated loopback MCP server that runs only in verified
  development builds and stops with Electron.
- Expose bounded tools for environment, provider, chat, run, permission, log,
  launch, cancel, and wait operations.
- Route launched tests through the same provider runtime and persistence paths
  used by the app instead of simulating replies or mutating the UI.
- Publish a local connection descriptor without exposing provider credentials.
- Keep packaged Preview and production builds disabled.

## Impact

- Affected specs: new `dev-test-control-mcp` capability.
- Affected code: Electron startup/shutdown, OpenCode run service extraction,
  dev test-control registry/service, MCP transport, and focused tests.
- Does not implement or replace the production `add-stage3-mcp-control` change.

# Change: Add connected development workflows

## Why

Users can supervise agents and inspect local work in Flapstack, but issue intake,
browser-based visual debugging, scripted product control, generic terminal agents,
and visible UI control still require context switches.

## What Changes

- Add one provider contract for GitHub, GitLab, Linear, Jira, Azure DevOps,
  Bitbucket, and Gitea, including complete hosted-review lifecycle controls.
- Add an embedded Chromium workspace with profiles, tabs, isolated
  identity/network controls, and Design Mode.
- Extend the `flapstack` command into a thin authenticated operator CLI.
- Ship version-matched operator, browser, Computer Use, and orchestration skill
  guides generated from the governed command schemas.
- Add an explicit lower-fidelity generic TUI agent runtime, named presets for
  Orca's advertised CLI agents, and compatible structured hook/status adapters.
- Add permission-gated, audited Computer Use through the existing authority model.

## Impact

- Affected specs: new `connected-development-workflows` capability.
- Affected code: credentials, provider adapters, worktree/task creation, PR review,
  BrowserView/CDP, browser sessions/credentials/downloads, visual context,
  app-control MCP, CLI transport, bundled skill manifests, runtime registry,
  permissions, audit, undo, mobile projections, and tests.

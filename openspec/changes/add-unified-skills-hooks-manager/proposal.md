# Change: Add a unified skills and hooks manager

## Why

Stage 3 can discover and mutate several provider-scoped extensions, but users
still need one honest place to manage what each harness loads and executes.

## What Changes

- Add one capability registry for skills, commands, plugins, custom agents, MCP
  entries, and hooks across supported harnesses.
- Preserve native provider files; use a small common metadata envelope instead
  of inventing false cross-provider parity.
- Add explicit copy/share conversion with preview, validation, backup, and
  unsupported-field reporting.
- Add project/task enablement policy and hook validation/dry-run; imported hooks
  are never enabled automatically.

## Impact

- Affected specs: new `extension-management` capability.
- Affected code: skills/commands/plugins routers, Settings extension tabs,
  provider capability registry, path validation, audit, and run-context assembly.

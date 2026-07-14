# Change: Stabilize the Stage 3 foundation

## Why

MCP control, approvals, audit persistence, and cross-agent spawning must not be
built on unresolved TypeScript or engineering debt.

## What Changes

- Inventory and resolve all TypeScript errors.
- Resolve Stage 3-blocking native ABI, schema, test, lint, and build debt.
- Enforce strict TypeScript through the normal local and CI gate.
- Record any non-blocking deferral with owner, reason, and destination.

## Impact

- Affected specs: new `engineering-quality` capability.
- Affected code: repository-wide TypeScript, native setup, tests, scripts, and CI
  where the evidence finds debt.

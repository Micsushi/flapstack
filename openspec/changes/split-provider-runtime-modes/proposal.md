# Change: Split Provider Runtime Parity and Enhanced Modes

## Why

The current direct Codex and Claude Code Runtimes use the providers' native
transports but also inject Flapstack context and extension policy. They are
therefore neither strict provider parity nor clearly labeled enhancements.
Users need an explicit choice between provider-like behavior, Flapstack-added
behavior, and the provider-neutral compatibility Runtime.

## What Changes

- Add `Codex Enhanced` and `Claude Code Enhanced` Runtime preferences.
- Keep `Codex` and `Claude Code` as provider-parity modes over the existing
  native adapters.
- Keep `Flapstack Native` as the shared normalized compatibility Runtime.
- Resolve parity and enhanced preferences to the same native transport adapter
  while snapshotting the selected preference on every run.
- In parity mode, preserve provider-native base/system prompts, instruction-file
  discovery, settings, tools, sessions, events, and controls without appending
  Flapstack startup/vault/managed-extension instructions.
- In enhanced mode, retain the current Flapstack context, vault, managed
  extension, MCP, hook, and policy additions.
- Require a new Chat continuation when switching parity/enhanced/native after
  provider work starts.
- Add migration, Settings/chat selectors, diagnostics, tests, and truthful
  release gates for the new preferences.

## Impact

- Affected specs: `agent-runtimes`.
- Affected code: Runtime preference types/resolution, launch-context policy,
  Codex App Server and Claude Agent SDK launch options, Runtime defaults and
  selectors, immutable snapshots, migration constraints, diagnostics, and tests.
- Stage 5 follow-up: `complete-runtime-orchestration-composition` will own
  capability-gated cross-provider Runtime adapters; it is not implemented by
  this change.

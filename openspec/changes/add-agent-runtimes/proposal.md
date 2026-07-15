# Change: Add native agent runtimes

## Why

Stage 3 can run Codex, Claude Code, Cursor, OpenRouter, and NanoGPT, but it
normalizes their output through one Flapstack message/tool pipeline. That common
path is useful for generic providers, yet it discards native Codex event
structure and turns Claude thinking into synthetic tool output. Users should be
able to keep each first-party harness's native session and activity behavior
while retaining a stable Flapstack-native option.

## What Changes

- Add the `Agent Runtime` concept, labeled `Runtime` in controls, independent
  from model choice, permission mode, reasoning effort, and multi-agent
  coordination engine.
- Add `codex`, `claude-code`, and `flapstack-native` runtimes plus an `auto`
  preference that resolves from the selected harness.
- Add global per-harness defaults, project per-harness overrides, and a chat
  override with an immutable resolved snapshot on every run.
- Add a direct Codex App Server adapter that preserves native thread, turn,
  item, reasoning, plan, tool, permission, usage, and recovery events.
- Preserve Claude Agent SDK content blocks, session lineage, thinking summaries,
  hooks, tools, permissions, and subagent activity without synthetic tool
  conversion.
- Keep the current normalized pipelines as `Flapstack Native` for other
  providers, migration, comparison, and rollback.
- Add one durable provider-neutral activity envelope and runtime-aware rendering
  without duplicating the full chat UI.
- Require a new chat branch/provider session when changing runtime after a chat
  has started.

## Impact

- Affected specs: new `agent-runtimes` capability; `orchestration-operations`
  consumes the resolved runtime and activity stream.
- Affected code: harness contracts, chat/run schemas, migrations, Settings,
  new-chat and chat continuation controls, Codex transport, Claude transformer,
  run launchers, reasoning/activity persistence, transcript rendering, provider
  capability checks, orchestration definitions, and parity fixtures.

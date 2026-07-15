# S4-F11 — Agent Runtimes

- Outcome: every chat uses a durable compatible Agent Runtime, preserving native
  Codex or Claude Code processing/activity when selected and retaining the
  current normalized pipeline as Flapstack Native.
- Change: `openspec/changes/add-agent-runtimes/`
- Tasks: `openspec/changes/add-agent-runtimes/tasks.md`
- Shared pickup packet: `openspec/changes/add-agent-runtimes/implementation-context.md`
- Task IDs and independent outcomes:
  1. S4-F11-T1 freezes the completed Stage 3 baseline.
  2. S4-F11-T2 owns shared Runtime contracts, resolver, schema, and migrations.
  3. S4-F11-T3 owns durable ordered activity.
  4. S4-F11-T4 owns the direct Codex adapter.
  5. S4-F11-T5 owns the native Claude Code adapter.
  6. S4-F11-T6 owns Flapstack Native compatibility.
  7. S4-F11-T7 owns the shared activity timeline.
  8. S4-F11-T8 owns Settings, chat selection, and continuation.
  9. S4-F11-T9 owns the central registry and orchestration-worker launch seam.
  10. S4-F11-T10 owns integrated acceptance and evidence.
- Dependencies: committed Stage 3 provider/reasoning baseline; F3 consumes the
  runtime contract and activity stream but does not own provider fidelity.

# Stage 3 integrated candidate release notes

Status: release candidate under validation; not Stage 3 complete.

## Included

- Production MCP control with default-off per-chat exposure, trusted identity,
  permission and approval gates, redacted audit, safe mutations, cross-harness
  spawn services, restart recovery, and renderer invalidation.
- Settings reliability work for visibility, shortcuts, Voice, write-only
  credentials, provider extensions, permission modes, copy, and search.
- Usage collection/daemon hardening, Cursor/OpenRouter/NanoGPT closeout, and
  reasoning classification, controls, persistence, and reload support.
- Development test-control MCP, migration coverage, macOS Preview packaging,
  bundled runtime inspection, and release-ledger validation.

## Required evidence still open

- On unlocked macOS, visually close full-history copy, today/older timestamps,
  the fresh two-file Review/Undo card, and background question notification/
  badge navigation with multiple chats.
- Rerun exact packaged Preview Usage LaunchAgent polling/restart/cleanup while
  the GUI session is unlocked.
- Close the remaining question stop/reload/provider aggregate and dependent
  task-board exits, then run the frozen-SHA release gates and independent S3-F17
  review rounds.

Exact-candidate Cursor, OpenRouter, NanoGPT, Codex, Claude, native Claude
question, Usage refresh, Discord HTTP 204, Dev identity, model-tuning UI, and
unsigned macOS Preview package/startup evidence now pass. Windows/Linux are
deferred to the end of Stage 4 by release decision.

No open row is promoted by fixture, prior-SHA, headless, macOS-only, or package
inspection evidence. See `docs/stage3-release-candidate-ledger.md` for the exact
crosswalk, cleanup contract, and current gate results.

Safe S3-F17 closeout also hardens Usage daemon startup against an early
SIGTERM/SIGINT race, adds regression coverage, and removes a stale local
development MCP registration discovered during exact Preview launch. See
`docs/stage3-release-handoff.md` for remaining release authority and next steps.

The agent-UX continuation adds authenticated development controls for bounded
Voice/Usage state, stored response Review/Undo, and renderer disclosure state.
It fixes canonical macOS temp-path reporting after Undo. These controls improve
repeatable evidence collection; they do not promote credentialed provider,
microphone, visual reasoning, or cross-platform acceptance. Apple signing and
notarization are deferred public-distribution work; OpenAI and Anthropic Admin
usage keys are also outside Stage 3 acceptance. See
`docs/future-release-considerations.md`.

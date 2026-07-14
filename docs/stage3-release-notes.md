# Stage 3 integrated candidate release notes

Status: Stage 3 complete at annotated tag `stage3-final`; local `main` is the
exact-tree squash. No push was performed.

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
- Final independent-review repairs for timestamp-unit integrity and migration,
  task-scoped chat moves, fail-closed custom permissions, passive credential
  status, abort-first bounded shutdown, and lossless Markdown/envelope handling.

## Completion evidence

- Full-history copy, today/older timestamps, fresh two-file Review/Undo, and
  background question notification/badge navigation pass.
- Exact packaged Preview Usage LaunchAgent start/poll/stop/new-PID restart and
  cleanup pass while the app is closed.
- Real Parakeet streaming, bundled Whisper fallback, Kokoro/native playback,
  Voice History CRUD, restart persistence, and user-observed microphone
  dictation pass.
- Questions pass answer, cancel, timeout, stop, reload, native Claude, and
  continuation delivery across all credential-available providers.
- The final Node 22 gate passes 130 test files, 984 tests, 3 conditional skips,
  lint, Prettier, TypeScript, and production build. Strict OpenSpec, release
  ledger, Usage matrix, package smoke, and independent review gates pass.
- Cold-load two-way product-MCP spawn cases have a focused 30-second test
  budget; ordinary tests retain the default timeout.

Exact-candidate Cursor, OpenRouter, NanoGPT, Codex, Claude, native Claude
question, Usage refresh, Discord HTTP 204, Dev identity, model-tuning UI, and
unsigned macOS Preview package/startup evidence now pass. Windows/Linux are
deferred to the end of Stage 4 by release decision.

No required row was promoted by fixture or prior-SHA evidence alone. Windows and
Linux execution is explicitly deferred to the end of Stage 4. See
`docs/stage3-release-candidate-ledger.md` for the exact crosswalk and cleanup
contract.

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

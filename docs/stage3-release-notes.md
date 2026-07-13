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

- Real Codex/Claude MCP exposure, approval, audit, spawn, stop, and restart UI.
- Visual Settings, Usage, provider, reasoning, accessibility, clipboard, Voice,
  microphone, and Keychain-backed credential lifecycle on unlocked macOS.
- Same-candidate UI-live provider/reasoning evidence where task boards require
  it, including Claude/Codex/Cursor recapture.
- Windows and Linux package, service, secret-store, and UI evidence.
- S3-F17 independent review rounds after automated and live release gates pass.

No open row is promoted by fixture, prior-SHA, headless, macOS-only, or package
inspection evidence. See `docs/stage3-release-candidate-ledger.md` for the exact
crosswalk, cleanup contract, and current gate results.

Safe S3-F17 closeout also hardens Usage daemon startup against an early
SIGTERM/SIGINT race, adds regression coverage, and removes a stale local
development MCP registration discovered during exact Preview launch. See
`docs/stage3-release-handoff.md` for remaining release authority and next steps.

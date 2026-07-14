# S4-F1-T6 Hook Safety Evidence

## Implemented

- Managed Claude Code and Codex hook inventory with schema-versioned, private,
  atomic file persistence.
- Imported hooks always start in `discovered` with `enabled: false`.
- Lifecycle gate: `discovered -> validated -> dry-run-passed -> enabled`, plus
  explicit `disabled`; enablement rechecks the exact definition revision after
  approval.
- Exact command preview with shell-free argv parsing. Shell operators,
  substitutions, multiline commands, and environment-prefix execution fail
  validation before dispatch.
- Bounded dry-run runner with a ten-second ceiling, one shared 64 KiB output
  budget, sanitized environment, Unix process-group termination, direct-child
  Windows termination, and a mockable service boundary.
- Tier 3 dry-run and enable approval through the final Stage 3 SQLite approval
  lifecycle.
- Append-only Stage 3 audit integration containing hook identity, lifecycle
  state, event, and command hash only. Exact commands, stdout, stderr, and
  credential values are excluded.
- User hooks ignore caller-supplied working directories. Project hooks require
  a registered root and revalidate its canonical identity immediately before a
  dry-run.

## Deliberate Limits

- No renderer or unified manager UI was added.
- No cross-harness conversion or copy path was added.
- No database migration or policy migration `0030` was changed.
- Native provider trigger wiring remains unavailable and is reported as
  `not-consumed`; this task does not claim that a managed enabled record is
  already injected into an external harness.
- No real command, Electron, provider, package, or live UI execution was used
  for code-ready evidence.

## Headless Evidence

- Hook/schema/state-machine/injection/timeout/redaction/persistence tests use a
  mocked dry-run runner and approval gate.
- Existing extension capability fixture, Stage 3 approval coordinator, and
  append-only audit/redaction tests remain green with the promoted hook rows.
- Node 22 TypeScript and focused ESLint pass.

## Remaining Proof

- Live Settings approval, enable, disable, and restart walkthrough.
- Native harness runtime-consumption wiring and one real supported-harness
  execution per promoted hook surface.
- Packaged preview, macOS runtime, Windows, and Linux evidence.
- Integrated S4-SH01 through S4-SH04 acceptance.

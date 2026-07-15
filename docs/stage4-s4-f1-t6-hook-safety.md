# S4-F1-T6 Hook Safety Evidence

## Implemented

- Managed Claude Code and Codex hook inventory with schema-versioned, private,
  atomic file persistence.
- Imported hooks always start in `discovered` with `enabled: false`.
- Lifecycle gate: `discovered -> validated -> dry-run-passed -> enabled`, plus
  explicit `disabled`; enablement rechecks the exact definition revision after
  approval.
- Enabled records reject validation and dry-run until the user explicitly
  disables them; rejected actions do not persist or invalidate state.
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
  dry-run, before enable approval, and again after approval before persistence.
  Disable remains available when that former root is stale.
- Runtime resolution rechecks the current run root, hook revision, validation,
  dry-run result, harness, and exact project authority before provider launch.
- Direct Claude launches receive SDK hook callbacks backed by a shell-free,
  timeout-bound, abortable runner with a sanitized environment and one 64 KiB
  output budget. Direct Codex launches receive lifecycle hook config only for
  validated modern Codex events. Neither path mutates provider hook files.
- The private state reader opens with no-follow semantics and verifies the
  opened descriptor identity, blocking symlink swaps and stale path reads.

## Unified manager integration

- The Extension Manager imports hooks disabled and exposes validation, bounded
  dry-run, explicit enablement, and disablement as preview-confirmed lifecycle
  actions.
- Validation and dry-run evidence is revision-bound. Stale or missing evidence
  disables later actions in the renderer and fails closed again in the service.
- Dry-run previews show the exact shell-free command and timeout before the Tier
  3 approval request. Enablement requires a separate Tier 3 approval.
- Lifecycle state and direct-runtime consumption support are visible together;
  unsupported harness and scope combinations remain explicit.

## Deliberate Limits

- No cross-harness hook conversion or copy path was added.
- No database migration or policy migration `0030` was changed.
- Native provider files are never rewritten. Launch-scoped injection applies
  only to direct Claude Code and Codex Runtime adapters; legacy provider routers
  keep their existing authority.
- The consolidated closeout executed `/usr/bin/true` through the real bounded
  runner and private file store in a temporary profile. Its approval gate was a
  controlled approval stub, not the live Stage 3 approval UI, and no native
  provider hook trigger was installed or invoked.

## Headless Evidence

- Hook/schema/state-machine/injection/timeout/redaction/persistence tests use a
  mocked dry-run runner and approval gate.
- Existing extension capability fixture, Stage 3 approval coordinator, and
  append-only audit/redaction tests remain green with the promoted hook rows.
- Node 22 corrected F1 coverage passes 15 files / 180 tests. TypeScript,
  formatting, focused ESLint, and diff checking pass.
- An isolated production-service smoke imported a Codex user hook disabled,
  validated it, executed a real bounded dry-run, enabled it, reloaded the file
  store, disabled it, and reloaded again. Enabled and disabled states survived
  their respective reloads; the temporary profile was removed.
- Runtime-resolution, Codex config, Claude callback, stale-root, and real
  shell-free callback execution are covered headlessly.

## Remaining Proof

- Live Settings approval and UI-driven enable/disable/restart walkthrough.
- One provider-observed supported-harness hook execution per promoted surface.
- Final-source packaged preview interaction, Windows, and Linux evidence.
- Integrated S4-SH01 through S4-SH04 acceptance.

## Recovery

Disable is always the first recovery action. If project identity is stale,
disable remains available from the stored record; validation, dry-run, enable,
and launch all fail closed. If the state file is unreadable or replaced, no
managed hook is launched. Repair or remove the private state file, then import,
validate, dry-run, and approve again.

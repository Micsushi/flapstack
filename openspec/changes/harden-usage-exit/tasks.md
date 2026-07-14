# S3-F14 Usage Hardening and Exit Board

This board replaces former Stage 2 task `2.12`. It is the sole completion
authority for Usage exit work.

### S3-F14-T1 — Freeze the Usage exit contract and evidence matrix

- [x] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / S3-F14 Usage Hardening and Exit
- Outcome: One executable matrix maps every Usage requirement to automated,
  live-provider, daemon, package, or platform evidence.
- Scope: Reconcile former U1-U11/U-exit rows; classify required, conditional,
  and unsupported rows; define isolated fixtures, exact evidence header,
  credential/webhook handling, pass/fail/block rules, and owners by row ID.
- Out of scope: Fix behavior or mark inherited rows passed without rerunning on
  the Stage 3 SHA.
- Acceptance:
  - Every `usage-exit-hardening` scenario maps to at least one stable row.
  - Rows name prerequisites, destructive boundaries, exact observations, and
    artifact locations.
  - No task or doc outside this board acts as a second completion checklist.
- Verification: strict spec review; row-to-requirement coverage script or
  documented cross-check; `openspec validate harden-usage-exit --strict`.
- Blocked by: none.
- Blocks: S3-F14-T2, S3-F14-T3, S3-F14-T4.
- Relevant context: `docs/stage2-full-feature-test-matrix.md`, Usage source and
  tests, `scripts/smoke-usage-daemon.mjs`.

### S3-F14-T2 — Close deterministic engine, store, and alert regressions

- [x] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / S3-F14 Usage Hardening and Exit
- Outcome: Automated tests prove overlap, provenance, failure, retry, locking,
  reconciliation, and alert invariants before live testing.
- Scope: Add or repair fixtures for app/daemon dedupe, cost precedence,
  unknown-price tokens, provider deadlines, provider continuation, WAL/busy
  retry, corrupt/failed writes, gaps, generation retry/reset, alert retry/re-arm,
  redaction, query errors, paging, filtering, and missing chart buckets.
- Out of scope: Provider credential setup or native service installation.
- Acceptance:
  - Exact/provider cost is never weakened; unknown price is never fabricated.
  - One failed provider or optional usage write cannot strand unrelated polling
    or a completed run.
  - Failed alert delivery remains retryable and successful delivery is unique.
  - UI queries distinguish empty, limited, and error states.
- Verification: focused Usage Vitest suites; `npm run smoke:usage-daemon` with
  isolated data; TypeScript and lint for touched files.
- Blocked by: S3-F14-T1.
- Blocks: S3-F14-T4, S3-F14-T5.
- Relevant context: `src/main/lib/usage/**`, `src/main/lib/usage-daemon/**`,
  `tests/usage-*.test.ts`, `tests/usage-dashboard.test.ts`.

### S3-F14-T3 — Prove secure daemon lifecycle on supported platforms

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / S3-F14 Usage Hardening and Exit
- Outcome: Closed-app collection and cleanup work with OS-backed secrets and no
  duplicate or orphan service.
- Scope: Verify install/start/heartbeat/poll, close app for one cadence, reopen,
  disable/uninstall, restart recovery, credential-store rejection, no-TTY secret
  write/read/delete probe, and process/service cleanup on each supported target.
- Out of scope: Use production credentials/services or claim an untested OS.
- Acceptance:
  - Exactly one scheduler writes a new sample while the app is closed.
  - Credential-store failure cannot become a false configured state.
  - Disable/uninstall stops heartbeat and leaves no task, unit, wrapper, or
    process behind.
  - Evidence contains no credential or webhook value.
- Verification: `npm run smoke:usage-daemon`; packaged/manual service matrix on
  macOS, Windows, and Linux where supported; sanitized process/service evidence.
- Verified safe subset (2026-07-13): the built daemon smoke proves one owner,
  duplicate rejection, forced-crash stale-lock recovery, restart, clean stop,
  cleared PID, and isolated database/config cleanup. A packaged Preview
  LaunchAgent smoke additionally proved closed-app start, heartbeat/poll, stop,
  new-PID restart, profile-scoped service/secret names, and exact job/plist/PID
  cleanup. A real no-TTY Keychain probe wrote, read, and deleted one unique
  namespaced item without placing its value in argv or output. A credentialed
  closed-app sample remains blocked by open prerequisite S3-F10-T4;
  Windows/Linux remain unobserved, so this completion box stays unchecked.
- Blocked by: S3-F14-T1, S3-F10-T4.
- Blocks: S3-F14-T5.
- Relevant context: daemon lifecycle/platform modules, usage secrets, package
  scripts, isolated OS service names and data directories.

### S3-F14-T4 — Prove provider and dashboard truthfulness live

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / S3-F14 Usage Hardening and Exit
- Outcome: Real provider samples and dashboard views agree with persisted data
  and honest provider limitations.
- Scope: Exercise available Codex/OpenAI, Claude/Anthropic, Cursor, OpenRouter,
  and NanoGPT sources with low-value credentials; verify exact/estimated/unknown
  cost, account/provenance tags, generation reconciliation, filters, show-all
  paging, charts, alerts, refresh failure, and no-zero gaps.
- Out of scope: Validate deferred organization Admin APIs or infer complete
  account history from run-only providers.
- Acceptance:
  - UI values and states match SQLite and sanitized provider evidence.
  - Provider limitations are visible and absent APIs do not become zero usage.
  - OpenRouter generation IDs and NanoGPT per-million pricing retain correct
    provenance.
  - Every conditional row records PASS, FAIL, or BLOCKED with a reason.
- Verification: verified dev profile (`npm run dev`, then
  `npm run dev:verify`), provider matrix, SQLite comparison, screenshots/logs
  with secrets redacted.
- Verified safe subset (2026-07-13): read-only personal OAuth probes returned
  one Codex and two Claude provider-reported quota samples with distinct metric
  keys, private-source tags, and opaque account tags. Cursor was not logged in;
  OpenRouter and NanoGPT were not configured. Both the earlier isolated
  `Flapstack Dev e899` run and this lane's exact `Flapstack Dev c100` profile
  passed `dev:verify`; the c100 app initialized its database and migrations.
  The Mac was locked during the c100 dev run. The exact packaged Preview window
  later became inspectable, but its clean no-project onboarding made Usage
  Settings unreachable. Visual dashboard/history, alert, filter, paging,
  settings, and fault-state comparisons therefore remain open.
- Blocked by: S3-F14-T1, S3-F14-T2, S3-F10-T4.
- Blocks: S3-F14-T5.
- Relevant context: Usage Settings/dashboard, provider adapters, generation
  proxy/reconciliation, exact evidence template.

### S3-F14-T5 — Publish and pass the Usage exit gate

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / S3-F14 Usage Hardening and Exit
- Outcome: Stage 3 has one truthful, SHA-bound Usage exit result ready for the
  integrated release gate.
- Scope: Run focused/full gates; reconcile every matrix row and limitation;
  verify docs/spec/tasks agree; record exact versions, profile, database,
  artifacts, failures, and rollback cleanup.
- Out of scope: Archive unrelated changes or waive a required row.
- Acceptance:
  - All required Usage rows pass; conditional/unavailable rows are explicit.
  - `npm run check` passes on Node 22 and strict OpenSpec passes.
  - The tested executable/profile and data store belong to the exact Stage 3
    checkout and final SHA.
  - No isolated service, credential, webhook, process, or test data is left
    unintentionally active.
- Verification: Node 22 `npm run check`; strict validation; verified dev and
  package evidence audit; `git diff --check`.
- Verified safe subset (2026-07-13): focused Usage/credential suites passed 107
  tests; matrix coverage, production build, enhanced daemon smoke, isolated
  verified dev, unsigned arm64 Preview build, binary inspection, bundled
  Claude/Codex/Whisper/Parakeet smoke, and clean process cleanup passed. The
  Preview daemon bundle also passed native LaunchAgent start/stop/restart and
  cleanup without opening the app. The exact packaged app then initialized,
  applied 23 migrations, exposed its main window, and shut down with zero
  projects/samples and no process, job, or plist left. Node 22 `npm run check`
  passed with 125 test files, 931 tests passed, and 3 credential-conditional
  tests skipped. Required Usage UI rows, credentialed alert delivery,
  Windows/Linux, and the final integrated SHA remain open, so this completion
  box stays unchecked.
- Blocked by: S3-F14-T2, S3-F14-T3, S3-F14-T4.
- Blocks: S3-F17-T2.
- Relevant context: this change, S3-F14 matrix/evidence, root live-dev rules.

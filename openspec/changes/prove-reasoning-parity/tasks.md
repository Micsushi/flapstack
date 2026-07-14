# S3-F16 Reasoning Parity and Evidence Board

This board replaces former Stage 2 tasks `5.8` and `5.8h`. It is the sole
completion authority for remaining reasoning parity work.

### S3-F16-T1 — Freeze the reasoning capability and evidence matrix

- [x] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / S3-F16 Reasoning Parity and Evidence
- Outcome: One current provider matrix defines visible, summary, token-only,
  opaque, absent, control, fallback, persistence, and evidence expectations.
- Scope: Reconcile T1-T7 and manual matrix rows for Claude, Codex, Cursor,
  OpenRouter, NanoGPT, and optional local adapters; define exact versions/models,
  capability probes, sanitized evidence, grading, and pass/fail/block rules.
- Out of scope: Declare parity because all providers render identical content.
- Acceptance:
  - Every spec scenario maps to stable matrix rows.
  - Each provider/model cell names request support and observed output class.
  - Fixture, capture, CLI-live, provider-live, UI-live, and reload evidence are
    distinct and no private reasoning is requested for artifacts.
- Verification: strict matrix/spec coverage review; provider capability probe
  review; `openspec validate prove-reasoning-parity --strict`.
- Blocked by: none.
- Blocks: S3-F16-T2, S3-F16-T3, S3-F16-T4.
- Relevant context: shared reasoning contract/normalizers, provider adapters,
  `tests/fixtures/reasoning-output/MANUAL_MATRIX.md`.

### S3-F16-T2 — Close normalization, classification, and fallback tests

- [x] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / S3-F16 Reasoning Parity and Evidence
- Outcome: Deterministic fixtures prove every supported output class and
  provider-aware control fallback without duplication or fabricated text.
- Scope: Add/update fixtures for deltas, cumulative/final replay, independent
  parts, summaries, thought chunks, token-only, encrypted/private, absent,
  malformed, legacy fields, tools/plans, on/off/effort capability, and fallback
  metadata across all required providers.
- Out of scope: Treat fixture replay as live-provider completion.
- Acceptance:
  - Stream/final replay dedupes only the same part and preserves later parts.
  - Token-only/private/absent shapes never create readable reasoning.
  - Unsupported request fields are omitted or mapped with an explicit recorded
    limitation.
  - Provider errors remain errors rather than assistant/reasoning prose.
- Verification: reasoning contract/normalizer/provider focused Vitest suites;
  fixture redaction review; TypeScript and lint for touched files.
- Blocked by: S3-F16-T1.
- Blocks: S3-F16-T3, S3-F16-T5.
- Relevant context: `src/shared/reasoning-output/**`, provider transports,
  `tests/fixtures/reasoning-output/**`, Cursor fixtures.

### S3-F16-T3 — Prove UI, timer, reload, and search parity

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / S3-F16 Reasoning Parity and Evidence
- Outcome: One reasoning disclosure remains accurate during stream, completion,
  remount, restart, history load, and search.
- Scope: Test incremental rendering, authoritative duration, completed toggle,
  final-only labels, tool/plan interleave, persistence, remount/reload, standard
  and legacy search, private-input exclusion, keyboard, and screen-reader state.
- Out of scope: Visual redesign unrelated to truthful disclosure.
- Acceptance:
  - Timer does not reset on remount or become a fake completed row.
  - Reload shows exactly persisted provider-visible content and duration.
  - Search finds visible reasoning but excludes opaque/private and hidden tool
    input.
  - Disclosure is reachable and state is announced accessibly.
- Verification: reasoning UI/duration/search integration suites; dev-test-control
  reasoning state inspection; verified dev remount/reload smoke.
- Blocked by: S3-F16-T1, S3-F16-T2; dev-test-control MCP closeout
  (`add-dev-test-control-mcp` tasks 2.5 and 3.4).
- Blocks: S3-F16-T5.
- Relevant context: reasoning UI, duration service, message persistence/search,
  dev MCP authoritative reasoning timer state.
- 2026-07-13 safe closeout: disclosure names and live-remount coverage pass;
  current and legacy search/private-exclusion suites pass; verified dev restart
  restores authoritative completed timers and message identities. The Mac is
  locked, so visual keyboard/screen-reader/disclosure/search proof remains open.
- 2026-07-13 unlocked follow-up: a clean same-tree Cursor chat rendered two
  completed reasoning disclosures with authoritative 18-second and 2-second
  labels, exact `auto` model identity, visible reasoning search, and persisted
  output after a real renderer reload. T3 remains open behind the full reasoning
  live-closeout prerequisites and remaining provider/accessibility rows.

### S3-F16-T4 — Capture live provider reasoning and no-fabrication evidence

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / S3-F16 Reasoning Parity and Evidence
- Outcome: Real required providers prove their current visible, summary,
  token-only, absent, and fallback behavior through persisted UI.
- Scope: Run low-cost Claude, Codex, Cursor, OpenRouter, and NanoGPT turns with
  supported reasoning settings; record exact versions/models/request resolution,
  sanitized event classes, timer/disclosure, assistant result, database parts,
  reload, no-reasoning cases, and limitations.
- Out of scope: Capture hidden chain-of-thought, decrypted provider details, or
  claim a provider emitted reasoning when it did not.
- Acceptance:
  - Each required provider has provider-live, UI-live, and persisted-reload
    evidence on the same Stage 3 SHA.
  - Token-only/private/absent runs remain honest and complete normally.
  - Capability and fallback claims match the actual request and provider result.
  - No secret or private reasoning appears in saved artifacts.
- Verification: verified dev (`npm run dev`, `npm run dev:verify`), provider
  matrix, dev-test-control inspection where supported, SQLite/message compare,
  sanitized screenshots/logs.
- Blocked by: S3-F16-T1, S3-F15-T5, S3-F10-T4.
- Blocks: S3-F16-T5.
- Relevant context: S3-F15 provider evidence, reasoning manual matrix, exact
  run/message IDs and provider versions.
- 2026-07-13 safe closeout: fresh current-tree OpenRouter enabled, disabled,
  and unsupported-fallback runs plus NanoGPT enabled/disabled runs passed and
  reloaded with exact persisted request resolution. Current runtime also
  restored prior Claude/Codex/Cursor visible and absent records, but those
  provider calls lack a recorded same-tree SHA. UI-live and same-SHA
  Claude/Codex/Cursor recapture remain open. Probe chats and approvals are clean.
- 2026-07-13 unlocked follow-up: Cursor same-tree provider-live, UI-live, and
  reload evidence now passes without private reasoning capture. Claude, Codex,
  OpenRouter, and NanoGPT same-tree UI rows remain unavailable, so T4 stays open.

### S3-F16-T5 — Publish and pass the reasoning parity gate

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / S3-F16 Reasoning Parity and Evidence
- Outcome: Stage 3 has one truthful, SHA-bound reasoning parity record ready for
  integrated release.
- Scope: Reconcile every provider/evidence row; run focused/full gates; audit
  persisted and UI evidence; update specs/tasks/docs truth; record blockers and
  cleanup without overstating parity.
- Out of scope: Waive a required live provider or substitute fixture status.
- Acceptance:
  - Required live, UI, reload, capability, fallback, and no-fabrication rows pass.
  - Conditional/unavailable rows name exact blockers.
  - Node 22 `npm run check`, strict OpenSpec, and verified dev identity pass on
    the final SHA.
  - Artifacts contain no hidden reasoning or credentials.
- Verification: focused suites; Node 22 `npm run check`; strict validation;
  evidence audit; `git diff --check`.
- Blocked by: S3-F16-T2, S3-F16-T3, S3-F16-T4.
- Blocks: S3-F17-T2.
- Relevant context: this change, final capability/evidence matrix, root live-dev
  rules, exact provider/run evidence.
- 2026-07-13 safe closeout: focused reasoning/provider suites, strict contract,
  verified dev identity/restart, database comparison, and sanitized evidence
  reconciliation pass. Node 22.23.1 `npm run check` passed 754 tests with 3
  credential-conditional skips and the production build. Unsigned macOS arm64
  Preview package inspection and bundled-runtime smoke passed. This task remains
  open while T3/T4 visual and same-SHA live blockers remain.

# S3-F15 Provider Harness Closeout Board

This board replaces former Stage 2 tasks `3.6`, `4.9`, and `4.11`. It is the
sole completion authority for their remaining provider-harness work.

### S3-F15-T1 — Reconcile provider contracts and freeze the closeout matrix

- [x] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / S3-F15 Provider Harness Closeout
- Outcome: Current Cursor, OpenCode, OpenRouter, and NanoGPT surfaces map to one
  exact fixture/live/package evidence matrix.
- Scope: Probe versions/help/status/models/events; reconcile D0-D5 and E1-E7
  rows; classify required/conditional/unsupported behavior; define evidence
  headers, low-cost credentials/models, cleanup, and pass/fail/block semantics.
- Out of scope: Preserve a stale assumption solely because an old fixture used it.
- Acceptance:
  - Every spec scenario maps to stable matrix rows and current capability data.
  - CLI headers/errors cannot parse as models and all probes have deadlines.
  - Fixture, CLI-live, provider-live, UI-live, and package evidence are distinct.
- Verification: capability probes; parser/timeout tests; strict spec/coverage
  review; `openspec validate close-provider-harnesses --strict`.
- Blocked by: none.
- Blocks: S3-F15-T2, S3-F15-T3.
- Relevant context: Cursor/OpenCode adapters, provider catalogs,
  `docs/stage2-full-feature-test-matrix.md` tracks D and E.

### S3-F15-T2 — Close Cursor auth, lifecycle, and persistence behavior

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / S3-F15 Provider Harness Closeout
- Outcome: Cursor reliably runs, retries, stops, resumes, and records one honest
  turn with exact provider/model and limitation state.
- Scope: Harden CLI parse/timeouts/status; browser/API-key auth; blocked-turn
  retry; stream/final dedupe; structured error/zero-exit failure; EPIPE; session
  continuation; cancellation; checkpoints/manifest; model persistence; image
  rejection; permission preview and limitations.
- Out of scope: Claim Cursor enforcement unavailable from its current CLI.
- Acceptance:
  - Successful live turn streams and persists all required run artifacts.
  - Auth recovery retries the existing turn without duplicate user messages.
  - Failed/cancelled/unsupported cases are terminal and visible.
  - Exact selected model survives continuation and restart.
- Verification: `tests/cursor-harness.test.ts`, credential/persistence focused
  suites, verified live Cursor matrix, database/run inspection.
- Blocked by: S3-F15-T1, S3-F10-T4, S3-F12-T5.
- Blocks: S3-F15-T5.
- Relevant context: `src/main/lib/cursor/**`, Cursor renderer transport,
  provider error normalization, reasoning fixtures.

### S3-F15-T3 — Close OpenRouter and NanoGPT runtime and model defaults

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / S3-F15 Provider Harness Closeout
- Outcome: Both OpenCode-backed providers complete low-cost live chats using
  exact, current, chat-capable model IDs.
- Scope: Harden sidecar resolution/health/session/subscription/prompt deadlines;
  isolated config and keys; catalog refresh/cache; default filtering; replace
  stale NanoGPT DeepSeek seed; live minimal completions; stream/reasoning/tool
  lifecycle; provider identity; package PATH resolution; cleanup.
- Out of scope: Adopt a new sidecar architecture or seed a model based only on
  catalog metadata.
- Acceptance:
  - OpenRouter and NanoGPT each complete one persisted live turn.
  - The NanoGPT seed is current and chat-capable, proven by a minimal live run.
  - Missing key/model/binary fails before misleading provider work.
  - Temporary config, child processes, and subscriptions clean up after every
    terminal outcome.
- Verification: OpenCode transport/sidecar/model-catalog suites; dev-test-control
  MCP live launch/wait; verified UI runs; package resolution smoke.
- Blocked by: S3-F15-T1, S3-F10-T4; dev-test-control MCP closeout
  (`add-dev-test-control-mcp` tasks 3.3 and 3.4).
- Blocks: S3-F15-T4, S3-F15-T5.
- Relevant context: `src/main/lib/harness/opencode-sidecar/**`, OpenCode tRPC
  router and renderer transport, model provider settings.

### S3-F15-T4 — Prove provider permissions, approvals, and run integrity

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / S3-F15 Provider Harness Closeout
- Outcome: Provider tools and concurrent lifecycle events obey the displayed
  permissions and preserve one coherent run record.
- Scope: Exercise allow/deny/ask modes; exact approval request and scope;
  allow-once/reusable/deny; no-handler fail-closed; overlapping subscriptions;
  message mutation; persistence failure; generation/usage hooks; failed,
  cancelled, and completed terminal state; audit correlation.
- Out of scope: Redefine permission modes or production MCP risk tiers.
- Acceptance:
  - Displayed permission application matches S3-F12 runtime enforcement.
  - No missing handler or unknown tool silently allows work.
  - Only the active run mutates its chat and existing messages survive by ID.
  - Tool decisions and terminal state agree across provider, run metadata, and
    production MCP audit where applicable.
- Verification: provider permission matrix, approval bridge and persistence
  integration tests, verified live allow/deny/cancel run, SQLite/audit compare.
- Blocked by: S3-F15-T3, S3-F12-T5, S3-F3-T4, S3-F4-T2, S3-F6-T2.
- Blocks: S3-F15-T5.
- Relevant context: OpenCode permissions/events/session/persistence, S3-F12
  capability contract, production MCP approval/audit services.

### S3-F15-T5 — Publish and pass provider harness exit

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / S3-F15 Provider Harness Closeout
- Outcome: One SHA-bound evidence record proves the required Cursor,
  OpenRouter, and NanoGPT release paths and honest limitations.
- Scope: Run focused/full gates and provider matrix; verify chips/models,
  create/send/retry/approve/deny/stop/resume/reload flows, persisted artifacts,
  package resolution, docs/task truth, cleanup, and exact evidence metadata.
- Out of scope: Mark a provider-live row passed from fixtures or another SHA.
- Acceptance:
  - Required provider-live and UI-live rows pass with exact chat/run evidence.
  - Every conditional credential/platform row is PASS, FAIL, or BLOCKED.
  - Node 22 `npm run check`, strict OpenSpec, and package smoke pass.
  - No key, generated config, temporary process, or test chat remains exposed or
    active unintentionally.
- Verification: focused suites; Node 22 `npm run check`; strict validation;
  verified dev (`npm run dev`, `npm run dev:verify`); package/provider matrix;
  `git diff --check`.
- Blocked by: S3-F15-T2, S3-F15-T3, S3-F15-T4.
- Blocks: S3-F16-T4, S3-F17-T2.
- Relevant context: this change, provider evidence matrix, live-dev/package
  identity rules, low-value credential policy.

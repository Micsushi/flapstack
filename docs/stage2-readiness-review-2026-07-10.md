# Stage 2 readiness review — 2026-07-10 (implementation update 2026-07-11)

Status: **the integrated automated baseline is green and the implemented feature rows are ready for manual testing; Stage 2 exit is not yet proven.**

The executable checklist is the [Stage 2 full-feature test matrix](./stage2-full-feature-test-matrix.md). This review explains why each track has its current status, what was repaired during the review, and what evidence is still required. A matrix row marked **READY** means the behavior is available to test, not that a human has passed it.

## 1. Executive verdict

Do not archive the Stage 2 OpenSpec change or call Stage 2 shipped yet.

The repair pass removed several blockers that would have made meaningful manual testing impossible: OpenRouter/NanoGPT can now be selected in new chat, OpenCode no longer deadlocks on approvals, provider reasoning follows the AI SDK lifecycle, Cursor final-only reasoning and structured errors are handled, voice playback is cancellable and first-use dictation readiness is visible, usage storage/alerts/errors are more honest, and the Stage 1 carryover surfaces are discoverable.

The remaining exit risk is concentrated in three areas:

1. Required live and packaged matrices remain incomplete, especially Windows voice, packaged speech prerequisites, provider credentials, daemon behavior with the app closed, and reasoning persistence through the real UI.
2. The previously blocked implementation rows now have testable paths. Their
   packaged, cross-platform, and credentialed behavior is not yet proven.
3. Dependency audit findings need remediation or explicit risk acceptance after
   direct/runtime exposure triage.

Exit recommendation: **NO-GO for Stage 2 exit; GO for all READY manual rows and applicable CONDITIONAL rows.**

## 2. Review scope and method

Reviewed surfaces:

- Track C: native/build prerequisites, branch creation, terminal actions, permissions, worktrees, scoped search, attachments/artifacts, run history, chat movement, and documentation.
- Track A: local dictation, native/Kokoro speech, `Spoken:`/`Displayed:` extraction, replay, interruption, settings, and OS failure states.
- Track B: usage schema/store, engine, daemon, reconciliation, provider adapters, Discord alerts, secrets, dashboard/settings, and cost provenance.
- Track D: Cursor CLI verification, process adapter, stream translation, sessions, permissions, identity, and model UI.
- Track E: OpenRouter/NanoGPT through the pinned OpenCode sidecar, configuration, HTTP/SSE flow, approvals, persistence, usage hooks, models, and onboarding.
- Track T: provider reasoning contracts, visible/opaque handling, streaming lifecycle, persistence, search, and manual parity.

Evidence sources:

- Current merged `main` implementation and focused diffs.
- OpenSpec proposal, design, task checklist, and feature specs.
- Provider fixtures and focused automated tests.
- Live Cursor CLI inspection and credential-free OpenCode lifecycle smoke.
- Track-specific audit and repair results from Voice, Usage, D/E/T, and Track C.
- The user-facing full-feature matrix linked above.

No live credential, email address, local absolute path, or secret is recorded here.

## 3. Baseline snapshot

### 3.1 Repository state at review start

- Review base: `main` at `14fc776` plus an integrated, intentionally dirty repair worktree.
- Before this review file was added: 59 tracked files modified and 12 untracked files.
- Tracked repair diff at that snapshot: 2,658 insertions and 376 deletions.
- No conflict markers were found.
- Historical Cursor, OpenCode-engine, and reasoning branches were clean and already merged; they were behind current `main`, not divergent ahead.
- Historical branch stats were Cursor 26 files, OpenCode engine 73 files, and reasoning 55 files. These overlap and must not be added together as a Stage 2 total.

### 3.2 Matrix size

After the 2026-07-11 implementation and evidence reconciliation, the matrix
contains 122 test rows:

| Classification | Rows | Meaning                                                          |
| -------------- | ---: | ---------------------------------------------------------------- |
| READY          |   86 | Implemented enough for the stated human test                     |
| CONDITIONAL    |   36 | Requires an OS, package, account, key, CLI, or provider behavior |
| BLOCKED        |    0 | No current matrix row lacks an implementation or scope decision  |

V6-02 and E7-03 are now READY because OpenCode prompts receive the read-aloud
instruction. F6-03 and P-10 were added for the Codex MCP cwd regression and
dependency-audit review. No checkbox is marked passed without human evidence.

### 3.3 Initial D/E/T automated baseline

- Eight focused files passed with 107 tests.
- The credential-free OpenCode lifecycle smoke passed when explicitly enabled.
- Two provider-paid live tests were skipped.
- Strict OpenSpec validation passed at the initial audit point.
- The initial audit ran on Node 26, which is not the release gate. The final gate
  ran on CI-equivalent Node 22.

### 3.4 Latest integrated automated evidence

- Clean install with `npm ci --legacy-peer-deps` passed.
- Final `npm run check` passed on CI-equivalent Node 22: lint, formatting, strict
  TypeScript, 342 tests passed, 3 skipped, across 37 files, plus the production build.
- A Node 24.14 attempt failed before tests while compiling `better-sqlite3`
  against the local V8/toolchain headers. Node 26 was correctly refused by the
  ABI guard. Use Node 22 for this test matrix until the Node 24 toolchain/prebuild
  path is repaired and revalidated.
- Strict OpenSpec validation passed for 3 changes.
- The usage-daemon smoke passed.
- The credential-free OpenCode live suite passed 52 tests; 2 paid-provider tests
  remained skipped.
- `npm run ts:check` passes and is now enforced by `npm run check` and CI.
- `npm audit` reported 1 low, 5 moderate, 9 high, and 0 critical findings. The
  production-only view reports 1 low and 1 moderate finding, both through
  Monaco's DOMPurify dependency. The 9 high findings are in Electron and
  build/packaging chains. Electron 39.4.0 is current within the pinned major;
  the electron-builder/tar chain points to a major builder upgrade that needs
  artifact validation.
- Paid provider matrices and packaged macOS/Windows matrices remain incomplete.

### 3.5 Live development-app evidence

The final reviewed source was launched with `npm run dev` against the separate
Flapstack Dev data directory. Database migrations completed and the main window
loaded. Agent-assisted UI inspection observed:

- Voice settings reported Local Whisper available with the 141 MB base model and
  Kokoro available. Preview and Stop were exercised without UI/main-process errors;
  audible output was not independently proven.
- Usage settings rendered summary/provider state, filters, honest empty/error
  surfaces, daemon state/action, credential configured/unconfigured state without
  echoing values, and recent sample/cycle/alert sections.
- OpenRouter appeared in normal new-chat model search with its seeded catalog.
  OpenRouter/NanoGPT API settings reported their current configured state and seed
  counts. NanoGPT model selection was not separately completed in the UI smoke.
- Local chat actions exposed Move to global/project/task destinations, with the
  current destination disabled.
- Final restart fetched MCP tools over stdio/HTTP without the previous repo-root
  `mcp/server.mjs` path failure, exercising the repaired Codex MCP cwd path.

No paid provider run was started. The persistent daemon install action was not
clicked. No packaged artifact or Windows device was tested. These observations
increase test readiness but do not convert the corresponding matrix rows to passed.

## 4. Severity-ranked findings

### P0 — blocked meaningful feature testing at review start

1. **OpenRouter/NanoGPT absent from normal new chat.** Settings could select a default, but new chat exposed only Claude, Cursor, and Codex and resolved unknown providers as Claude models.
2. **OpenCode synchronous prompt deadlock.** Flapstack subscribed to SSE, awaited the synchronous message endpoint, and only then consumed SSE. An approval request waited for Flapstack while Flapstack waited for the request to finish.
3. **Invalid OpenCode reasoning stream.** `reasoning-delta` arrived without `reasoning-start`, and no `reasoning-end` was emitted. The AI SDK rejects that protocol.
4. **Voice controls could be undiscoverable on first use.** The mic disappeared when Local Whisper was unavailable, and the user could not reach the model-download or prerequisite path from chat.
5. **Usage daemon and persistence safety defects.** Daemon startup could duplicate work; unknown-price token usage could disappear; provider HTTP could hang; weaker duplicate costs could overwrite stronger data; and failed Discord delivery could incorrectly disarm alerts.

All five were repaired in this pass.

### P1 — correctness, safety, or exit blockers

- OpenCode-derived cost remains labeled estimated until reconciliation. A
  localhost pass-through now captures official OpenRouter `X-Generation-Id`
  headers before OpenCode discards them, and multi-step rows persist separately.
  Provider-live proof remains open.
- OpenCode tool inputs, outputs, errors, permission scope, decisions, and permission limitations were not durable. Repaired with bounded/redacted assistant run metadata and persisted tool parts.
- Usage persistence failure could skip run/sub-chat finalization. Repaired by isolating required status writes from optional usage enrichment.
- Cursor completed-only reasoning was discarded. Repaired.
- Cursor structured errors could still produce a successful run when the process exited zero. Repaired.
- Standard Cursor/OpenCode `reasoning` parts were not searchable. Repaired.
- Voice fallback could pass a Kokoro-only voice to native TTS, speed could be applied twice, replay lacked message identity, and stale synthesis could resume after Stop. Repaired.
- Usage query/provider failures could look like empty data, history was silently capped, secret fallback behavior was too permissive, and OpenRouter generations were not reconciled. Repaired in the Usage slice.
- Strict TypeScript passes repository-wide and is enforced by the real gate.
- Packaged dictation now has a pinned whisper.cpp build/download recipe and
  renderer-side PCM WAV conversion, removing the runtime FFmpeg dependency.
  Real macOS/Windows artifacts still need pristine-machine tests.
- Personal Codex/Claude quotas, full Cursor source 1, historical charts, and
  Windows/Linux daemon lifecycle now have implementations and automated coverage.
  Credentialed/platform evidence remains conditional.

### P2 — usability, documentation, and completeness gaps

- Cursor permission degradation is primarily visible after a response; pre-launch presentation still needs human verification and may need more wiring.
- Cursor API-key fallback is wired through `CURSOR_API_KEY`; live CLI proof remains.
- The model selector can repeat Cursor disconnected UI across provider groups, and some cross-provider confirmation copy/model handoff paths need manual inspection.
- OpenCode catalog pricing, supported parameters/tools, modalities, context, and
  reasoning hints are preserved when providers expose them; live NanoGPT proof remains.
- OpenCode packaging still needs Finder/PATH, first-download timeout, process-tree teardown, and Windows packaged tests.
- OpenCode image evidence is sent to the provider but attachment persistence/reload needs manual verification.
- Opaque/private reasoning persistence is specified but not fully proven through a durable metadata sink for every provider.
- Codex saved reasoning summary is largely end-of-run backfill rather than a proven live provider bridge.
- Terminal title sanitization removes control characters but must be tested with secret-shaped commands; do not assume it redacts credentials.
- Remote-stats policy and several OpenSpec task checkboxes remain administratively stale.

## 5. Repairs completed during this review

### 5.1 Voice

- Native fallback clears provider-specific voice IDs before invoking OS speech.
- Speech requests now have cancellation/preemption identity; stale Kokoro results cannot fall back, play, or persist after Stop.
- Playback rate is applied by the audio element once, not both synthesis and playback.
- Manual replay includes chat, sub-chat, and message identity so resolved spoken text/history can be reused.
- Renderer playback exposes shared playing state and a visible Stop action.
- Starting a new run stops renderer audio and main-process native synthesis.
- Empty-input mic remains visible in active and new chat.
- Readiness distinguishes missing Whisper engine, missing FFmpeg, missing model, download progress, retry, and ready state.
- Missing tools route to Voice settings; missing model starts/observes/retries download through persistent feedback.
- Settings state explicitly says speech binaries are not bundled and dictation has no cloud fallback.

### 5.2 Usage

- Daemon startup is side-effect free and has a dedicated smoke path.
- Token-only samples persist with unknown cost when pricing is unavailable.
- Provider HTTP has a 15-second timeout with sanitized errors.
- Duplicate upserts rank exact/provider-reported cost above estimated/unknown cost.
- Failed Discord delivery remains retryable and does not prematurely disarm an alert.
- Stale secrets can be cleared; no new plaintext fallback is written; local fallback files use restrictive permissions.
- OpenRouter reconciliation uses stored generation IDs, preserves run links, upgrades provenance when exact/provider data exists, and treats 404 as an honest gap.
- Usage dashboard errors are visible; embedded provider failures and limited-history providers are surfaced.
- Provider/account filters apply server-side to samples, cycles, alerts, and provider states.
- History supports incremental and show-all paging with honest caps.
- Current cards compose latest non-null fields without fabricating zero.
- Daemon install/stop UI is capability-driven and shown only on supported macOS.

### 5.3 Cursor and reasoning

- Completed-only Cursor reasoning produces one complete reasoning part.
- Streamed reasoning followed by final reasoning does not duplicate.
- Structured error events and error result subtypes force failed run status even with exit code zero.
- Shared chunk types now include reasoning start/end boundaries.
- Standard reasoning parts are indexed by in-chat and scoped search.

### 5.4 OpenRouter/NanoGPT through OpenCode

- Normal new-chat selection now exposes both providers and persists the exact chosen catalog model.
- Prompt dispatch uses `/prompt_async` after SSE subscription.
- Reasoning delta and summary paths emit valid `start → delta → end` lifecycles and were processed by the actual AI SDK stream reducer.
- Approval UI displays the exact command and requested patterns/paths.
- Approval scope and command propagate through event, callback, pending approval, and UI layers.
- Tool inputs, outputs, errors, approval requests/decisions, and policy/user/fallback source persist in bounded, redacted assistant metadata tied to the run ID.
- Permission application and limitations persist on failed, cancelled, and successful paths.
- Pending approval resolves on cancellation instead of hanging the run.
- Required run/sub-chat finalization is isolated from checkpoint, manifest, and usage failures; usage capture runs after status writes.
- Missing provider key now fails preflight before prompt/run persistence.
- Sidecar password is redacted.
- OpenCode prompts now receive the same read-aloud instruction contract as Claude/Codex/Cursor.
- Stale runtime documentation was corrected to the asynchronous prompt path.

### 5.5 Track C

- Create-branch now checks out the created branch in both Changes selectors.
- Terminal file links preserve line and column through editor-specific goto arguments.
- Relative Codex plugin MCP executable/argument paths now resolve from the
  Codex-reported MCP working directory instead of inheriting the Flapstack process
  cwd. The targeted regression test and final full gate pass.
- Custom worktree input validates absolute path, existence, directory type, resolved path, and Git checkout before use.
- Scoped search returns message IDs, opens the correct sub-chat, seeds in-chat search, and targets the exact message.
- Standard reasoning is searchable without indexing unrelated hidden tool inputs.
- Search results support pages beyond the first 20.
- Attachment trays expose show-all; task artifacts can open stored files/images or readable inline text.
- Run history exposes show-all/show-fewer beyond the five-run preview.
- Local chat overflow and context menus expose Move to Global/project/task, revalidate targets, exclude remote chats, and synchronize selected scope after success.
- Moving between projects no longer mistakes the source project default checkout for an explicit custom checkout.
- Moving a true explicit custom checkout to global preserves that explicit selection.

## 6. Feature readiness by track

### Track C — carryover and test-surface completion

| Feature                             | Status      | Remaining evidence or work                                                                               |
| ----------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| F1 strict TypeScript                | READY       | Zero errors; `ts:check` is enforced by `npm run check` and CI                                            |
| F2 native ABI prerequisite          | CONDITIONAL | Node 22 rebuild/gate passed; current Node 24.14 toolchain failed; Node 26 is intentionally unsupported   |
| F3 branch creation                  | READY       | Manual success, invalid-name, and forced-failure rows                                                    |
| F4 terminal actions                 | PARTIAL     | File goto repaired; manually verify all panes, title updates, and secret-shaped title input              |
| F5 remote stats                     | READY       | Aggregate summary only until remote chat is opened locally; no fake diff/commit actions                  |
| F6 Claude/Codex permissions/MCP cwd | CONDITIONAL | Pre-run limitation preview and cwd regression pass; manually verify each mode and real plugin launch     |
| F7 worktree UX                      | READY       | Manual valid/invalid/custom/removed-checkout matrix                                                      |
| F8 search                           | READY       | Deep-count, archived/scope, exact scroll/highlight matrix                                                |
| F9 attachments/artifacts            | READY       | More-than-six, promotion, view, missing-content, traversal, overwrite matrix                             |
| F10 run history                     | READY       | More-than-five and old checkpoint/manifest navigation                                                    |
| F11 scope movement                  | READY       | Full global/project/task/cross-project matrix                                                            |
| F12 docs consistency                | READY       | README, OpenSpec follow-ups/tasks, matrices, track notes, and vault handoff now share the review verdict |

### Track A — voice

| Feature                     | Status      | Remaining evidence or work                                                          |
| --------------------------- | ----------- | ----------------------------------------------------------------------------------- |
| V1 adapters/settings        | READY       | Clean settings persistence and adapter listing                                      |
| V2 local STT                | CONDITIONAL | Bundling/WAV path implemented; pristine packaged macOS/Windows proof remains        |
| V3 macOS native TTS         | CONDITIONAL | Audible packaged/dev preview and immediate Stop                                     |
| V4 Windows native TTS       | CONDITIONAL | SAPI packaged test                                                                  |
| V5 Kokoro                   | CONDITIONAL | Dependency/model download, offline synthesis, voice, fallback, package test         |
| V6 Spoken/Displayed         | READY       | OpenCode prompt injection repaired; verify all five harnesses in UI                 |
| V7 voice UX                 | READY       | Replay/history/preemption/visible Stop manual matrix                                |
| V8 settings/model lifecycle | READY       | Tiny/base/small picker plus independent verified lifecycle; manual UI proof remains |
| V9 OS failures              | CONDITIONAL | Denied mic, no device, missing binaries/model/FFmpeg, packaged usage strings        |
| V-exit                      | BLOCKED     | macOS and Windows manual matrix unchecked                                           |

The batch-versus-live dictation scope must remain explicit: the implemented Stage 2 path is batch Local Whisper. Do not silently convert tentative/live dictation into an exit requirement without a scope decision.

### Track B — usage and limits

| Feature              | Status      | Remaining evidence or work                                                                    |
| -------------------- | ----------- | --------------------------------------------------------------------------------------------- |
| U1 schema/store      | READY       | Seeded pre-Stage-2 migration and duplicate-quality manual checks                              |
| U2 engine/scheduler  | READY       | Fake-provider timeout and continuation tests                                                  |
| U3 daemon            | CONDITIONAL | LaunchAgent/Scheduled Task/systemd implemented; each platform needs closed-app proof          |
| U4 SQLite safety     | CONDITIONAL | Concurrent app/daemon lock and corruption manual tests                                        |
| U5 reconcile/refresh | READY       | Historical versus current-only gap labeling                                                   |
| U6 OpenAI/Anthropic  | CONDITIONAL | Admin and personal local-OAuth paths implemented; live credentials required                   |
| U7 Cursor            | CONDITIONAL | Full source 1 and manual-token fallback implemented; live account required                    |
| U8 OpenRouter        | CONDITIONAL | Official generation-header capture implemented; live reconciliation required                  |
| U9 NanoGPT           | PARTIAL     | Run-only honesty exists; pricing and account-history coverage incomplete                      |
| U10 alerts           | PARTIAL     | Retry/re-arm repaired; per-run OpenRouter/NanoGPT alerts not yet daemon-routed                |
| U11 dashboard        | READY       | Current cards plus historical quota/cost/token charts; manual light/dark/filter proof remains |
| U-exit               | BLOCKED     | Live provider, daemon-closed, alert, and UI manual matrix unchecked                           |

### Track D — Cursor harness

| Feature                   | Status      | Remaining evidence or work                                                                     |
| ------------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| D0 CLI verification       | READY       | Installed CLI version observed as `2026.07.08-0c04a8a`; rerun on exit machine                  |
| D1 identity/contract      | READY       | Verify teal chip on every producer surface                                                     |
| D2 process/stream/session | CONDITIONAL | Logged-in live run, Stop, resume, checkpoints, manifest                                        |
| D3 onboarding             | CONDITIONAL | Login/status/models plus API-key fallback implemented; live fallback proof remains             |
| D4 permissions            | PARTIAL     | Mapping exists; prove pre-launch limitations and real edit behavior                            |
| D5 model/UI               | PARTIAL     | Exact new-chat model works; inspect cross-provider model handoff and duplicate disconnected UI |
| D-exit                    | BLOCKED     | Dedicated live/manual exit record absent                                                       |

Cursor images remain explicitly unsupported and must fail before run rather than disappear.

### Track E — OpenRouter/NanoGPT through OpenCode

| Feature                | Status      | Remaining evidence or work                                                                      |
| ---------------------- | ----------- | ----------------------------------------------------------------------------------------------- |
| E0/E8 engine decision  | READY       | Sidecar remains Stage 2 path; revisit on permission, latency, capability, or packaging failure  |
| E1 contract            | READY       | Reconcile task status with actual limitations                                                   |
| E2 launcher/client     | CONDITIONAL | Dev lifecycle ready; packaged PATH/download/process-tree/Windows teardown tests                 |
| E3 config/credentials  | READY       | Missing key preflight and password redaction repaired; verify packaged credential path          |
| E4 streaming/reasoning | CONDITIONAL | Protocol repaired; live OpenRouter and NanoGPT UI runs required                                 |
| E5 tools/approvals     | CONDITIONAL | Persisted sanitized audit repaired; real allow/always/deny tool-loop matrix required            |
| E6 persistence/usage   | CONDITIONAL | Multi-generation persistence and official header capture automated; provider-live proof remains |
| E7 onboarding/catalog  | CONDITIONAL | Pricing/tool/modality/reasoning metadata implemented; provider-live cache proof remains         |
| E-exit                 | BLOCKED     | Credentialed app matrix and packaged lifecycle not recorded                                     |

The durable approval/tool audit currently lives in assistant message metadata keyed by run ID and in persisted tool parts. If independent run-history queries must expose it without loading messages, add a dedicated `agent_runs` metadata column in a separately reviewed migration.

### Track T — reasoning-output parity

| Feature                       | Status      | Remaining evidence or work                                                       |
| ----------------------------- | ----------- | -------------------------------------------------------------------------------- |
| T0 behavior matrix            | READY       | Keep fixtures versioned with provider/CLI changes                                |
| T1 contract/persistence rules | READY       | Opaque persistence needs end-to-end proof                                        |
| T2 UI/search                  | READY       | Incremental growth, reload, search, exact navigation manual test                 |
| T3 Claude                     | CONDITIONAL | Live delta and final/backfill behavior                                           |
| T4 Codex                      | PARTIAL     | ACP thought and token paths exist; live summary and opaque durability need proof |
| T5 Cursor                     | CONDITIONAL | Final-only/error repairs automated; live emitted/no-emitted cases required       |
| T6 OpenRouter/NanoGPT         | CONDITIONAL | Valid lifecycle automated; credentialed provider shapes required                 |
| T7 exit matrix                | BLOCKED     | Provider/platform matrix remains unchecked                                       |

Only provider-visible reasoning or provider-authored summaries may render. Encrypted/private content remains opaque; token counts are usage metadata, not readable reasoning.

## 7. Automated evidence collected

| Slice                               | Evidence                                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Voice final focused suite           | 46/46 passed across dictation readiness, voice speech, and future scaffolds                           |
| Voice earlier replay/fallback suite | 31/31 passed; combined earlier voice/future run 39/39 passed                                          |
| Usage final focused suite           | 40/40 passed; targeted production build passed                                                        |
| Track C sidebar move helpers        | 7/7 passed                                                                                            |
| D/E/T current focused suite         | 8 files, 116 passed, 3 live/credential-conditional skipped                                            |
| D/E/T initial baseline              | 8 files, 107 passed; credential-free lifecycle passed when enabled                                    |
| Clean install                       | `npm ci --legacy-peer-deps` passed                                                                    |
| Final integrated check              | Node 22; 37 files, 342 passed, 3 skipped; lint, formatting, strict types, and production build passed |
| Strict OpenSpec                     | 3 changes validated successfully                                                                      |
| Usage daemon smoke                  | Passed                                                                                                |
| OpenCode credential-free live suite | 52 passed; 2 paid-provider tests skipped                                                              |
| Dependency audit                    | All: 1 low/5 moderate/9 high; production-only: 1 low/1 moderate/0 high; remediation pending           |
| Strict TypeScript                   | Passed; promoted into `npm run check` and CI                                                          |
| Formatting/lint                     | Track-targeted Prettier, ESLint, and `git diff --check` passed during repairs                         |
| TypeScript                          | Repository-wide strict check passes                                                                   |

The final integrated `npm run check` row is the authoritative automated baseline;
slice rows show focused coverage and live-smoke depth.

## 8. Live and manual gaps

Highest-value manual sequences after the full automated gate:

1. Voice on dev macOS: local dictation, PCM WAV conversion, all model download states, native voice, Kokoro, fallback, replay identity, new-run interruption, and visible Stop.
2. Voice on pristine packaged macOS and Windows: bundled engine, model download,
   mic denial/no-device, native TTS, Kokoro, and Stop without system FFmpeg.
3. Usage daemon on macOS, Windows, and Linux: install, close app, wait one cadence,
   verify native-secret access/heartbeat/sample/Discord, reopen, disable/uninstall,
   and verify no duplicate process.
4. Usage providers: low-value admin/provider credentials, exact/estimated/unknown labels, 404 generation gap, filters, paging, refresh failure, and no zero fabrication.
5. Cursor: plan/read-only/ask/full access, text/reasoning/tool/error, cancel, resume, model persistence, checkpoints, manifest, and unsupported image rejection.
6. OpenRouter and NanoGPT: missing-key preflight, text stream timing, visible/no-visible reasoning, tool allow/always/deny, cancel during pending approval, reload tool/approval metadata, usage failure finalization, and provider error.
7. Track C: more than 20 search results, more than six attachments, more than five runs, exact search navigation, valid/invalid custom worktrees, file:line:column links, branch failure recovery, and every chat move direction.

Use disposable repositories, low-value provider keys, a disposable Discord webhook, and the row IDs from the full-feature matrix. Never put credentials in screenshots or logs.

## 9. Exact verification instructions

Run from a clean checkout under Node 22, matching CI. Node 24 remains a documented
local target, but 24.14 failed the native rebuild on this Mac and is not valid exit
evidence until that path is repaired.

```bash
npm ci --legacy-peer-deps
npm ls kokoro-js @huggingface/transformers --depth=0
npm run check
npm run ts:check
npx -y @fission-ai/openspec validate --changes --strict --no-interactive
npm run smoke:usage-daemon
FLAPSTACK_OPENCODE_LIVE_TEST=1 npx vitest run tests/opencode-sidecar.test.ts
git diff --check
```

Then launch the app and execute [the full-feature matrix](./stage2-full-feature-test-matrix.md):

```bash
npm run dev
```

For package-specific rows, create and test the real platform artifact rather than treating dev mode as equivalent:

```bash
npm run build
npm run package:mac
```

Use the repository-supported Windows packaging command on Windows for Windows-only rows. Provider-live tests can incur cost and must be explicitly enabled with low-value credentials.

## 10. Final verification record

| Gate                               | Required result                                         | Result                           | Evidence                                                            |
| ---------------------------------- | ------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------- |
| Clean `npm ci --legacy-peer-deps`  | Pass                                                    | **PASS**                         | Clean-install command completed                                     |
| `npm run check`                    | Lint, style, strict types, tests, production build pass | **PASS**                         | Node 22; 342 passed, 3 skipped, 37 files                            |
| `npm run ts:check`                 | Pass and promoted into gate/CI                          | **PASS**                         | Zero errors                                                         |
| Strict OpenSpec validation         | Pass after final docs/spec edits                        | **PASS**                         | 3 changes valid                                                     |
| Usage daemon smoke                 | Pass on supported macOS                                 | **PASS**                         | Smoke completed                                                     |
| Credential-free OpenCode lifecycle | Pass and teardown within five seconds                   | **PASS**                         | 52 passed, 2 paid-provider skips                                    |
| Dependency audit                   | High findings triaged/remediated or risk-accepted       | **TRIAGED; REMEDIATION PENDING** | Electron current in major; builder upgrade needs package validation |
| Packaged macOS matrix              | Required rows pass                                      | **PENDING**                      |                                                                     |
| Packaged Windows matrix            | Required rows pass                                      | **PENDING**                      |                                                                     |
| Credentialed provider matrix       | Cursor/OpenRouter/NanoGPT required rows pass            | **PENDING**                      |                                                                     |
| Reasoning manual matrix            | Required providers pass through saved UI                | **PENDING**                      |                                                                     |
| Track C deep-count matrix          | Required rows pass                                      | **PENDING**                      |                                                                     |
| Final docs/task reconciliation     | Matrix, OpenSpec, README, handoff agree                 | **PASS FOR REVIEW STATE**        | All point to this verdict/matrix                                    |

Record commit, OS/architecture, Node/Electron version, packaged/dev mode, row IDs, provider/CLI versions, failures, and evidence links for every run.

## 11. Exit criteria and recommendation

Stage 2 can exit only when:

- the integrated supported-Node gate is green;
- strict TypeScript is either completed as approved or explicitly re-scoped through OpenSpec;
- every required READY/CONDITIONAL matrix row passes on its required platform;
- every remaining BLOCKED row is implemented, formally deferred, or removed from scope;
- live provider behavior matches persisted UI behavior, not only fixtures;
- usage provenance never upgrades local/derived data to provider-reported or exact without proof;
- private reasoning and credentials remain non-displayable and sanitized;
- packaged voice/provider discovery matches dev behavior;
- OpenSpec tasks, README, matrix, and handoff are synchronized to evidence.

Current recommendation: use the live dev app to execute the matrix in the order
above, then run packaged/platform and credentialed rows. Do not archive or announce
full Stage 2 completion from the green automated baseline alone.

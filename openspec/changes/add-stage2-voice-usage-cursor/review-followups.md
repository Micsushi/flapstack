# Stage 2 Review Follow-ups

Current review: `docs/stage2-readiness-review-2026-07-10.md`

Executable matrix: `docs/stage2-full-feature-test-matrix.md`

This file replaces the pre-integration branch notes. Stage 2 is ready for the
implemented manual rows, but it is not ready to archive or call shipped.

## Repaired during the integrated review

- First-use dictation is discoverable and routes missing binaries to Voice
  settings; the approved base model has download progress, retry, and honest
  local-only failure states.
- Local STT never silently falls back to cloud.
- Create branch creates and switches; both Changes selectors refresh.
- Native module ABI preparation is automated by the repo scripts. A clean
  `npm ci --legacy-peer-deps` plus `npm run check` completes without a manual
  developer toggle.
- Cursor, OpenCode harness, reasoning, Voice, Usage, and Track C worktrees are
  integrated on `main`; the old divergent-branch sequencing warning is obsolete.
- OpenCode approval deadlock, invalid reasoning lifecycle, missing durable tool
  audit, and finalization coupling were repaired.
- Usage daemon double-start, unknown-price loss, weak-cost overwrite, alert retry,
  secret fallback, and OpenRouter reconciliation defects were repaired.
- OpenCode usage aggregation now preserves provider-reported totals, downgrades
  mixed totals to their weakest quality, and hydrates persisted model pricing at
  run capture instead of depending on model-list UI order.
- Codex MCP probing and ACP forwarding now preserve Codex-reported stdio working
  directory semantics so plugin-relative launch paths do not resolve from the
  Flapstack checkout.

## Implementation update — 2026-07-11

The full matrix now has zero `BLOCKED` rows. The items below are validation and
release gates; no manual row is marked passed by this implementation update.

### Voice and packaging

- Build and test the pinned bundled `whisper-cli` recipe in pristine macOS and
  Windows artifacts. Renderer PCM WAV capture removes the runtime FFmpeg dependency.
- Execute audible native/Kokoro, denied-microphone, no-device, packaged macOS,
  and Windows SAPI/microphone rows.
- Verify tiny/base/small model selection and independent download state. Batch
  Local Whisper is the Stage 2 decision; live/tentative sidecar STT is deferred.

### Usage

- Verify personal Codex/Claude quota windows with local OAuth sessions.
- Verify full Cursor source 1 and manual-token fallback with a real account.
- Verify historical quota/cost/token charts against seeded and provider data.
- Verify Windows Scheduled Task and Linux systemd user lifecycle plus native-secret access.

### Harnesses and reasoning

- Verify provider-live multi-step aggregation and official OpenRouter
  `X-Generation-Id` reconciliation; proxy and persistence coverage are automated.
- Verify provider-live pricing/tool/modality/reasoning catalog metadata.
- Execute credentialed Cursor, OpenRouter, and NanoGPT runs through the app,
  including approvals, Stop/resume, persistence, search, and error cases.
- Execute packaged OpenCode PATH/download/process-tree teardown on macOS and
  Windows.
- Complete the real UI reasoning matrix; fixture coverage alone is not exit proof.

### Repository gate and administration

- Reconcile OpenSpec/task-board checkboxes only against executed evidence.
- Address dependency audit debt: current clean install reports no critical
  vulnerabilities. The production-only tree has no high findings, but the packaged
  Electron 39.4.0 is current within its pinned major. electron-builder's high
  build-chain findings require a validated major upgrade or risk acceptance.

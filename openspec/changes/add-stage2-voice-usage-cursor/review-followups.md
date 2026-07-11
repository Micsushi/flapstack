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

## Remaining product blockers

### Voice and packaging

- Bundle or deliberately provision `whisper-cli` and FFmpeg for a pristine
  packaged app; current development readiness depends on system tools.
- Execute audible native/Kokoro, denied-microphone, no-device, packaged macOS,
  and Windows SAPI/microphone rows.
- Decide whether live/tentative dictation and a broader model picker are Stage 2
  requirements; the approved implementation is batch Local Whisper with `base`.

### Usage

- Implement personal Codex/Claude subscription quota paths if Stage 2 must fully
  replace onWatch for the user's primary accounts.
- Complete Cursor source 1: plan, grants, Stripe balance, request usage, account
  shapes, and robust token fallback.
- Add approved historical graph/dashboard depth.
- Route OpenRouter/NanoGPT per-run spend alerts through the daemon alert runner.
- Add Windows/Linux service lifecycle or explicitly rescope daemon exit to macOS.

### Harnesses and reasoning

- Verify provider-live OpenCode multi-step aggregation and generation-ID
  provenance; automated cost-quality aggregation is repaired.
- Complete OpenCode model pricing/tool-capability metadata.
- Execute credentialed Cursor, OpenRouter, and NanoGPT runs through the app,
  including approvals, Stop/resume, persistence, search, and error cases.
- Execute packaged OpenCode PATH/download/process-tree teardown on macOS and
  Windows.
- Complete the real UI reasoning matrix; fixture coverage alone is not exit proof.

### Repository gate and administration

- Resolve the sidebar remote-stats product decision.
- Reconcile OpenSpec/task-board checkboxes only against executed evidence.
- Address dependency audit debt: current clean install reports no critical
  vulnerabilities. The production-only tree has no high findings, but the packaged
  Electron runtime has a non-major security patch available and electron-builder's
  high build-chain findings require a validated major upgrade or risk acceptance.

# Stage 2 full-feature test matrix

Snapshot: 2026-07-10. This is the user-facing exit matrix for Stage 2. It is
intentionally stricter than the automated suite: a fixture or mocked provider
does not count as a live UI pass.

## Status legend

- **READY** — the surface is wired and can be tested now on a supported local
  setup. The checkbox remains empty until a human completes the steps.
- **CONDITIONAL** — testable only with the named OS, credential, CLI, model, or
  external account.
- **BLOCKED** — implementation or product-scope work is still missing. Do not
  turn a blocked item into a pass by accepting a thinner behavior.

Stage 2 is complete only when every required READY/CONDITIONAL row passes on its
required platform and every BLOCKED row is implemented, explicitly deferred in
the approved spec, or removed from scope.

## 0. Safe test setup

Use a disposable Git repository and disposable provider test data. Branch,
worktree, attachment-write, permission, and tool-approval tests can mutate the
selected checkout.

1. Install Node 22, matching CI. Do not use this Mac's Node 24.14 for exit
   evidence: its `better-sqlite3` native rebuild failed before tests. Node 26 is
   intentionally rejected by the ABI guard.
2. Run `npm ci --legacy-peer-deps` from a clean checkout. Plain `npm ci` is not
   supported while the pinned Claude SDK requires Zod 4 and the app still uses
   Zod 3; CI uses the same legacy-peer flag.
3. Run `npm run check`.
4. Run `npx -y @fission-ai/openspec validate --changes --strict --no-interactive`.
5. Run `npm run smoke:usage-daemon` on macOS. A later `npm run test` or
   `npm run dev` automatically restores the native ABI it needs.
6. Run `FLAPSTACK_OPENCODE_LIVE_TEST=1 npx vitest run tests/opencode-sidecar.test.ts`
   for the credential-free OpenCode process/health/session smoke.
7. Create a disposable repository with at least two branches, one untracked
   file, one modified file, and a second valid Git checkout for custom-worktree
   testing.
8. Launch with `npm run dev`. Confirm the console names the development
   `userData` directory; do not test against production data by accident.
9. Add one global chat, two projects, two tasks under different projects, and a
   chat in each scope. This enables move/scope/search coverage.
10. Keep DevTools open during the matrix. Record UI errors, renderer exceptions,
    main-process exceptions, and the exact row ID that produced them.

### Automated preflight

Latest automated evidence, recorded without checking the human boxes below:

- `npm ci --legacy-peer-deps` passed from the clean-install sequence.
- Final `npm run check` passed on Node 22 with 303 tests passed and 3 skipped
  across 32 files, plus lint, formatting, strict TypeScript, and the production build.
- Strict OpenSpec validation passed for 3 changes.
- The macOS usage-daemon smoke passed.
- The credential-free OpenCode live suite passed 38 tests; 2 paid-provider tests
  remained skipped.
- `npm run ts:check` passes and is enforced by `npm run check` and CI.
- `npm audit` reported 1 low, 5 moderate, 9 high, and 0 critical findings. The
  production-only tree has no high finding, but Electron 39.4.0 is the packaged
  runtime and has a non-major 39.8.10 fix available. The electron-builder/tar
  findings require a larger builder upgrade. Remediate or explicitly risk-accept
  them before release; counts alone do not prove exploitability.
- The final development app launched from the reviewed source. Agent-assisted UI
  smoke observed Voice/Usage settings, OpenRouter new-chat discovery, Move to
  destinations, and successful MCP tool probing. Paid, audible, daemon-install,
  NanoGPT-selection, packaged, and Windows evidence remains unchecked below.

- [ ] **P-01 READY** `npm ci --legacy-peer-deps` finishes with Kokoro and
      Transformers present.
      Verify with `npm ls kokoro-js @huggingface/transformers --depth=0`.
- [ ] **P-02 READY** `npm run check` passes lint, formatting, tests, and production
      build under Node 22.
- [ ] **P-03 READY** `npm run ts:check` passes and is part of `npm run check`
      and CI.
- [ ] **P-04 READY** strict OpenSpec validation passes.
- [ ] **P-05 READY (macOS)** the usage-daemon smoke writes a heartbeat/poll row,
      exits cleanly, and reports `usage daemon smoke passed`.
- [ ] **P-06 READY** the OpenCode lifecycle smoke launches the pinned sidecar,
      reaches health, creates a session, and tears down within five seconds.
- [ ] **P-07 READY** `git diff --check` reports no whitespace errors.
- [ ] **P-08 CONDITIONAL** packaged macOS app launches from Finder with the same
      provider/CLI discovery as `npm run dev`.
- [ ] **P-09 CONDITIONAL** packaged Windows app launches and finds every bundled
      or required voice/provider executable.
- [ ] **P-10 CONDITIONAL** dependency-audit findings are reviewed and either
      remediated or explicitly risk-accepted with direct/runtime exposure noted.

## 1. Track C — MVP carryover and test-surface completion

### Branch and terminal

- [ ] **F3-01 READY** Open Changes, open the branch menu, choose **Create new
      branch**, enter a valid name, and submit. Expected: validation succeeds, the
      checkout switches to the new branch, and both Changes branch selectors refresh.
- [ ] **F3-02 READY** Repeat with an invalid name such as `bad..name`. Expected:
      the dialog shows the backend validation error and does not create or switch.
- [ ] **F3-03 READY** Force a Git create/checkout failure. Expected: the dialog
      remains recoverable and the old branch stays selected.
- [ ] **F4-01 READY** Print a relative file link, an absolute file link, a
      `file:line` link, and a `file:line:column` link in Terminal. Click each.
      Expected: the configured/found editor opens the exact file; Cursor/VS Code use
      their goto form and honor line/column.
- [ ] **F4-02 READY** Run a command. Expected: its sanitized command becomes the
      terminal-tab title; secrets/control sequences do not become the title.
- [ ] **F4-03 READY** Focus terminals in sidebar, bottom panel, and details panel.
      Expected: the active pane/tab state follows focus in every surface.

### Permissions and worktrees

- [ ] **F6-01 READY** For Claude and Codex, inspect every permission mode before
      launch. Expected: enforced controls and limitations are honest; no UI claims a
      stronger sandbox than the harness provides.
- [ ] **F6-02 READY** Launch a no-edit prompt in read-only mode and explicitly ask
      it to write a file. Expected: the write is blocked or a visible limitation says
      why true read-only cannot be guaranteed. Verify the checkout, not only the UI.
- [ ] **F6-03 READY** Launch Codex with a plugin MCP server whose command path is
      relative to the plugin directory. Expected: the command resolves against the
      Codex-reported MCP cwd and the server starts. The targeted resolver regression
      and full repository gate pass; this row proves the real plugin process.
- [ ] **F7-01 READY** Select project default and task default worktrees. Expected:
      the selected cwd and worktree chip match the target.
- [ ] **F7-02 READY** Enter an absolute path to another valid Git checkout.
      Expected: Flapstack validates existence, directory type, and Git-repository
      status before accepting its resolved path; the next run uses it as cwd.
- [ ] **F7-03 READY** Try a relative path, missing path, regular file, and existing
      non-Git directory. Expected: **Use** is disabled for relative input and the
      other cases show actionable validation errors without changing the run cwd.
- [ ] **F7-04 READY** Remove or invalidate a selected worktree after selection.
      Expected: the UI shows unknown/needs-refresh, not a false clean state.

### Search, attachments, runs, and scope movement

- [ ] **F8-01 READY** Create more than 20 scoped-search results. Expected: **Show
      more** reveals every result in pages of 20; include-archived and scope filters
      remain applied.
- [ ] **F8-02 READY** Search a deep user/assistant text match. Expected: clicking
      the result selects the exact chat and sub-chat, opens in-chat search with the
      query, highlights the target, and scrolls to the exact message. Include visible
      file-content text so backend and in-chat indexes remain identical.
- [ ] **F8-03 READY** Search standard `reasoning` output from Cursor/OpenCode.
      Expected: it is indexed and the owning assistant message is located. Tool
      commands and unrelated hidden metadata remain excluded.
- [ ] **F8-04 READY** Search matching project and task titles. Expected: rows
      without an owning chat are labeled informational results and are not exposed
      as dead buttons; chat/message/attachment rows remain navigable.
- [ ] **F9-01 READY** Add at least seven attachments. Expected: six-item preview,
      explicit **Show all**, and access to all attachments.
- [ ] **F9-02 READY** Promote file, image, and pasted-text attachments to a task.
      Expected: each remains visible under **Task artifacts** after switching chats.
- [ ] **F9-03 READY** Click **View artifact** for stored files/images and inline
      text. Expected: file viewer opens stored files/images; a readable modal opens
      inline text. Missing content produces an explicit error.
- [ ] **F9-04 READY** Write an artifact to the selected worktree. Expected: path
      traversal and unknown roots are rejected; overwrite requires confirmation.
- [ ] **F10-01 READY** Produce more than five runs in one chat. Expected: preview
      shows five, **Show all** exposes every run, and **Show fewer** restores preview.
- [ ] **F10-02 READY** Inspect old runs. Expected: status, harness/model, prompt,
      checkpoint, and manifest links remain reachable where recorded.
- [ ] **F11-01 READY** From a local chat overflow menu and context menu, choose
      **Move to...**. Expected: global, active project, and active task destinations
      are discoverable without enabling drag/drop power-user mode.
- [ ] **F11-02 READY** Move global → project → task → global. Expected: history,
      archive/pin state, and sub-chats survive; scope/project/task metadata changes;
      default worktree follows destination rules; detach-to-global clears
      project-owned checkout defaults.
- [ ] **F11-03 READY** Move between tasks in different projects. Expected: target
      task/project agree and no stale source-project metadata remains.

## 2. Track A — voice

The compact OS matrix remains in `docs/voice-manual-matrix.md`; these rows add
the setup and cross-harness checks needed for full Stage 2 exit.

### Dictation

- [ ] **V2-01 BLOCKED (clean install)** With no speech cache and no Homebrew
      helpers, click the microphone. Required result: the mic remains discoverable,
      Flapstack explains the missing tools, starts the approved `base` model download
      once tools exist, and shows progress/retry. Current packaged resources still do
      not bundle `whisper-cli` or FFmpeg, so pristine packaged dictation remains blocked.
- [ ] **V2-02 READY (prepared macOS)** With `whisper-cli`, FFmpeg, and the base
      model available, record WebM/M4A speech. Expected: local transcript is inserted
      for review, never auto-sent, and identifies Local Whisper.
- [ ] **V2-03 READY** Select local STT, make the local engine unavailable, and
      dictate. Expected: no cloud upload/fallback; actionable local prerequisite.
- [ ] **V2-04 CONDITIONAL (macOS/Windows)** Deny microphone permission. Expected:
      explicit OS recovery instructions. Repeat with no microphone device.
- [ ] **V2-05 BLOCKED (scope decision)** Resolve approved batch whisper.cpp versus
      the newer cross-platform/live sidecar proposal before treating live/tentative
      dictation as a Stage 2 requirement.
- [ ] **V2-06 READY** Hold the voice hotkey, release it while microphone permission
      or device startup is still pending, then allow startup to finish. Expected:
      Flapstack immediately stops or cancels the late stream; the microphone cannot
      remain active after release. Repeat with window blur during startup.

### Speech and read-aloud

- [ ] **V3-01 CONDITIONAL (macOS)** Native preview speaks audibly at selected
      voice/rate. Stop interrupts immediately.
- [ ] **V4-01 CONDITIONAL (Windows)** SAPI preview speaks audibly and Stop
      interrupts immediately.
- [ ] **V5-01 CONDITIONAL** Kokoro dependencies/model install, offline synthesis,
      selected Kokoro voice, and playback all work without an API key.
- [ ] **V5-02 READY** Force Kokoro failure after selecting a Kokoro-only voice.
      Expected: native fallback clears/remaps the provider-specific voice and still
      speaks; it never passes `af_heart` to the OS voice command. Repeat by switching
      directly to Native and with Kokoro unavailable before synthesis.
- [ ] **V6-01 READY** Enable read-aloud for Claude, Codex, and Cursor. Expected:
      only the harness-authored `Spoken:` block is read; code/tables/logs and the
      `Displayed:` block are not spoken.
- [ ] **V6-02 READY** Repeat V6-01 for OpenRouter and NanoGPT. The OpenCode prompt
      now receives the same read-aloud instruction contract; verify provider-live UI
      output before checking this row. Include a two-item `-` bullet list inside
      `Spoken:`; both items must be audible and must not be mistaken for diff lines.
- [ ] **V6-03 READY** Use a reply without `Spoken:`. Expected: deterministic
      non-LLM fallback text, no extra model request, and persisted resolved speech.
- [ ] **V7-01 READY** Click Play on an existing message. Expected: chat/sub-chat/
      message identity is persisted, speed is applied once by playback, and replay
      does not re-extract or duplicate history. Mutate spoken metadata during an
      overlapping harness run and verify finalization preserves it.
- [ ] **V7-02 READY** Start a second utterance, start a new run, and press visible
      Stop during playback. Expected: old audio and native synthesis stop; stale
      Kokoro output cannot play, fall back, or persist. Repeat in two windows:
      preemption in one window must not invalidate speech in the other.
- [ ] **V7-03 READY** Toggle global and per-chat read-aloud. Expected: per-chat
      override wins, an inheritance/reset path is understandable, and history does
      not auto-play.
- [ ] **V8-01 BLOCKED** Select whisper model and fully manage model lifecycle in
      Settings. Current approved scope says `base`, but the board also requires a
      model picker and honest download lifecycle surfaces.
- [ ] **V9-01 CONDITIONAL (packaged macOS/Windows)** Verify usage strings,
      permission prompt, denied state, missing engine, missing model, missing FFmpeg,
      and no-device behavior in packaged apps.

## 3. Track B — usage and limits

Use low-value test credentials and a disposable Discord webhook. Never paste a
secret into logs or screenshots. Settings must show configured/unconfigured
state without echoing the value.

### Engine, store, daemon, and safety

- [ ] **U1-01 READY** Migrate a seeded pre-Stage-2 DB. Expected: samples, cycles,
      alerts, provider states, and daemon status tables appear without data loss.
- [ ] **U1-02 READY** Insert daemon/app/reconcile duplicates. Expected: stable
      dedupe keys prevent double count; token-only samples persist with unknown cost.
- [ ] **U1-03 READY** Upsert estimated after exact/provider-reported data.
      Expected: weaker cost never overwrites stronger cost while useful token/raw
      metadata can still fill gaps. Exact reconciliation must preserve model, token
      counts, request count, run link, and raw payload; metric keys such as
      `input_tokens` remain visible while credential fields are redacted.
- [ ] **U2-01 READY** Run fake providers in app and daemon modes. Expected:
      equivalent normalized samples and provider states.
- [ ] **U2-02 READY** Hang a provider request. Expected: 15-second timeout,
      source-unavailable state, and later providers continue polling. Test both a
      fetch that never returns headers and a response whose JSON body never resolves.
- [ ] **U3-01 READY (macOS)** Install/start daemon, close Flapstack, wait one
      cadence, reopen. Expected: exactly one daemon/scheduler, fresh heartbeat/poll,
      and new DB sample without opening UI. Force a Keychain write failure first;
      Settings must reject the credential instead of claiming a safeStorage fallback
      that the closed-app daemon cannot read.
- [ ] **U3-02 READY (macOS)** Disable/uninstall daemon. Expected: process exits,
      status stops advancing, and no duplicate/orphan process remains.
- [ ] **U3-03 BLOCKED (Windows/Linux)** Native service/scheduled-task lifecycle is
      not implemented; UI must not offer a working install action there.
- [ ] **U3-04 READY (macOS Electron)** Through a temporary isolated no-TTY
      Electron main-process probe, write a disposable secret using a unique
      Keychain service/account, read it back, and delete only that unique entry. Expected: the
      `security add-generic-password -w` stdin fallback works; no real Cursor or
      Flapstack credential is touched, and the secret never appears in argv, logs,
      or error text.
- [ ] **U4-01 READY** Keep app reads open during daemon writes. Expected: WAL/
      busy-timeout/retry prevents silent loss. Repeat a forced lock and corruption
      case and verify visible failure.
- [ ] **U5-01 READY** Stop daemon for a gap, relaunch app, and press Refresh now.
      Expected: historical providers reconcile; limited providers label unrecoverable
      gaps instead of inventing samples. Generation retries use persisted backoff,
      become terminal after the bound, and can be explicitly reset for retry.
- [ ] **U10-01 READY** Cross a quota threshold with app closed. Expected: exactly
      one Discord event; app later shows the persisted delivery.
- [ ] **U10-02 READY** Return below threshold then cross again. Expected: re-arm
      and one new alert.
- [ ] **U10-03 READY** Force Discord 500 then recover. Expected: failed event is
      visible, threshold remains armed, next daemon tick retries, success then
      disarms it.
- [ ] **U10-04 CONDITIONAL (OpenRouter/NanoGPT key)** Verify per-run spend alerts.
      A completed run must route its exact or estimated sample through the shared
      alert runner, persist delivery, and obey the same retry/re-arm behavior.

### Provider coverage

- [ ] **U6-01 CONDITIONAL (OpenAI Admin key)** Poll organization usage/cost.
      Expected: provider-reported/exact cost, account tag, raw payload without secret.
- [ ] **U6-02 CONDITIONAL (Anthropic Admin key)** Poll Admin Usage/Cost APIs with
      the same provenance and secret rules. Confirm the API `amount` decimal-string
      cents value is divided by 100 exactly once and matches Claude Console USD.
      Force a two-page response and confirm `next_page` is sent back as the `page`
      cursor without skipping or repeating a bucket.
- [ ] **U6-03 BLOCKED (personal subscriptions)** Personal Codex quota/profile and
      Claude Code local OAuth quota paths are not implemented. Flapstack cannot yet
      replace onWatch for these main subscription accounts.
- [ ] **U7-01 CONDITIONAL (Cursor logged in)** Auto-detect local Cursor token and
      poll current-period usage with source tag `internal`. Provider state and the
      usage card must remain under the same default-account filter; `internal` is
      provenance, not a fabricated account name.
- [ ] **U7-02 BLOCKED** Complete onWatch source 1: plan info, credit grants,
      Stripe balance, request usage, robust account types, and manual-token fallback.
- [ ] **U8-01 CONDITIONAL (OpenRouter key)** Poll key limits/balance and label the
      provider `run usage plus balance`, never complete account history. Confirm
      `/models` per-token prompt/completion prices become per-million cache values
      and one token-only run receives a nonzero `estimated` cost.
- [ ] **U8-02 BLOCKED (OpenRouter run)** Persist run tokens and estimated OpenCode
      message cost without mislabeling the OpenCode assistant-message ID as an
      upstream generation ID. Exact `/api/v1/generation` reconciliation remains
      blocked until a verified upstream generation ID is available.
- [ ] **U8-03 READY** A 404/unavailable generation remains an honest gap; no fake
      zero-dollar exact sample is written. It becomes terminal instead of retrying
      every poll; manual retry clears that state.
- [ ] **U8-04 READY** Render an OpenRouter key-limit sample with percentage absent.
      Expected: `usd-micros` quota values display as dollars (for example `$5 / $20`),
      never as raw `5,000,000 / 20,000,000` integers.
- [ ] **U9-01 CONDITIONAL (NanoGPT key)** Refresh model pricing and capture run
      tokens/cost. Require `pricing.unit=per_million_tokens`; compare one estimate
      against NanoGPT's displayed per-million rates. If exact cost is absent,
      estimate and label it estimated.
- [ ] **U9-02 READY** UI says NanoGPT is run-usage-only unless a current verified
      account-history endpoint exists.

### Dashboard/settings

- [ ] **U11-01 READY** Open Settings → Usage. Expected: current summary cards,
      provider/account filters, recent samples/cycles/alerts, exact/estimated/unknown
      labels, explicit loading/empty/error/limited states, and show-all paging.
- [ ] **U11-02 READY** Configure cadence, provider toggles, thresholds, keys,
      Discord webhook, daemon state, and Refresh now without editing files.
- [ ] **U11-03 BLOCKED** Reimplement the approved onWatch historical graphs and
      top-level dashboard depth. Raw settings tables alone do not satisfy U11 exit.
- [ ] **U11-04 READY** On a platform without daemon support, the install action is
      hidden/disabled with an honest explanation before click.
- [ ] **U11-05 READY** Query/provider/refresh failure is visible and cannot look
      like a legitimate empty or zero state.

## 4. Track D — Cursor harness

- [ ] **D0-01 READY** `cursor-agent --version`, `--help`, model listing, and login
      status match the adapter assumptions. Record CLI version.
- [ ] **D0-02 READY** Model output headers such as `Models:` and `Available models`
      never appear as selectable IDs. In the adapter regression harness, a
      deliberately hung CLI command rejects with a typed timeout rather than a
      normal null-exit result; status converts that failure into an explicit
      unknown/error detail.
- [ ] **D1-01 READY** Cursor appears as a first-class provider with teal chip in
      new chat, chat header, sidebar, and run history.
- [ ] **D2-01 CONDITIONAL (Cursor login)** Start a read-only Cursor chat with
      model `auto`. Expected: session starts, assistant text streams, run/checkpoints/
      manifest persist, Stop cancels, and continuation resumes the session.
- [ ] **D2-02 READY** A completed-only reasoning event creates one complete
      reasoning part. Streamed then final reasoning does not duplicate. A later
      second id-less completed-only block is also rendered and persisted.
- [ ] **D2-03 READY** Structured error/result failure marks the run failed even if
      the process exits zero. It emits an error chunk and is not persisted as normal
      assistant prose. Closed stdin/EPIPE also remains inside the failed-run boundary.
- [ ] **D3-01 CONDITIONAL** Connected/not-logged-in states are accurate; Connect
      opens local Cursor login and Retry refreshes status/models. `Unauthenticated`
      is disconnected, numeric filenames do not trigger auth, and early login child
      close/error reports `started: false`.
- [ ] **D3-02 BLOCKED** Local-token-only fallback remains deferred.
- [ ] **D4-01 READY** Before launch, each permission mode shows applied Cursor
      flags and limitations. Failed/empty runs must still preserve the warning.
      Current warning is mainly post-response, so this row remains an exit check.
- [ ] **D4-02 CONDITIONAL** Ask-before-edits prompts for a tool action; read-only
      blocks edits; full access visibly warns before launch.
- [ ] **D5-01 READY** Select a live Cursor model, create a chat, continue an
      existing chat with Cursor, and verify exact provider/model persistence.
- [ ] **D5-02 READY** Images are rejected before run with an honest unsupported
      message, not silently dropped.

## 5. Track E — OpenRouter and NanoGPT through OpenCode

Provider-live rows can incur API cost. Use the lowest-cost model/account limits.

- [ ] **E1-01 READY** OpenRouter and NanoGPT appear in normal new-chat provider
      selection. Selected exact catalog model persists on chat/sub-chat/run.
- [ ] **E2-01 READY** Sidecar starts with isolated config and generated local
      password, health checks, creates session, and tears down without leaking the
      config directory or child process. In the packaged macOS app launched from
      Finder, resolve OpenCode or Homebrew `npx` despite the minimal inherited PATH.
      Never-resolving health/session requests must hit a deadline and still clean up.
- [ ] **E2-02 READY** Prompt uses `/prompt_async` after SSE subscription. Expected:
      text/reasoning streams before completion and tool approval cannot deadlock.
      Hung prompt/approval requests honor Stop and the request deadline.
- [ ] **E3-01 CONDITIONAL** Provider keys are stored securely; generated config
      references environment variables and never contains key material.
- [ ] **E3-02 READY** Missing key/model/binary stops before provider work and
      produces an actionable state. A missing key should not create a misleading run.
- [ ] **E4-01 CONDITIONAL (OpenRouter key)** Run a minimal completion. Expected:
      valid text stream, `reasoning-start → deltas → reasoning-end`, persisted text/
      reasoning, and success status.
- [ ] **E4-02 CONDITIONAL (NanoGPT key)** Repeat E4-01 using NanoGPT.
- [ ] **E5-01 CONDITIONAL** Trigger shell/edit/web permission. Expected: approval
      UI shows exact command plus requested patterns/paths before **Allow once**,
      **Always allow**, or **Deny**.
- [ ] **E5-02 CONDITIONAL** Deny and allow each request. Expected: provider tool
      loop continues correctly; decision and request scope persist in run metadata.
- [ ] **E5-03 READY** No approval handler defaults to rejection, never silent allow.
- [ ] **E6-01 CONDITIONAL** Successful/failed/cancelled runs persist status,
      session, before/after checkpoints, manifest, full sanitized tool activity,
      permission application/decisions, provider/model, and usage. Start two
      overlapping subscriptions plus a mid-run message mutation: only the active run
      may append or update sub-chat status, and existing messages survive by ID.
- [ ] **E6-02 READY** Force usage persistence failure after provider completion.
      Expected: telemetry error cannot leave run/sub-chat stuck `running`.
- [ ] **E6-03 BLOCKED** Verify real provider generation ID and multi-step usage
      aggregation. OpenCode message IDs/zero derived prices must not be labeled exact.
- [ ] **E7-01 READY** Settings key status, model refresh/cache/seed distinction,
      default selection, provider chips, and new-chat flow agree.
- [ ] **E7-02 BLOCKED** Catalog pricing/tool-capability metadata required by the
      approved spec is still incomplete.
- [ ] **E7-03 READY** OpenCode prompts receive the Voice `Spoken:`/`Displayed:`
      read-aloud instruction. Verify both providers live before checking this row.

## 6. Track T — reasoning-output parity

- [ ] **T1-01 READY** Shared fixtures normalize visible reasoning, summary,
      token-only, and opaque/private forms without rendering encrypted content;
      sanitized opaque metadata persists for reload/audit.
- [ ] **T2-01 READY** Three deltas visibly grow one reasoning panel and final does
      not duplicate it. Combined text/reasoning compatibility events maintain
      independent baselines, and pending→running tool updates emit one start. Reload
      and verify persistence.
- [ ] **T2-02 READY** Scoped/in-chat search finds standard reasoning and legacy
      visible reasoning tools while excluding hidden tool inputs.
- [ ] **T3-01 CONDITIONAL (Claude)** Live Claude visible reasoning streams and
      final-only/backfill behavior match fixtures.
- [ ] **T4-01 CONDITIONAL (Codex)** ACP visible thought renders; token-only usage
      is labeled reasoning tokens; encrypted content stays opaque.
- [ ] **T5-01 CONDITIONAL (Cursor)** Live Cursor reasoning appears before final
      answer when emitted; no-reasoning reply remains normal.
- [ ] **T6-01 CONDITIONAL (OpenRouter/NanoGPT)** Provider visible reasoning and
      legacy `reasoning_content` use the same panel and valid stream lifecycle.
- [ ] **T7-01 CONDITIONAL** Complete the platform/provider manual matrix in
      `tests/fixtures/reasoning-output/MANUAL_MATRIX.md`. Fixture-tested is not the
      same as app-tested.

## 7. Exit record

Record one line per run:

```text
Date/time:
Commit:
OS + architecture:
Node/Electron version:
Packaged or dev:
Row IDs tested:
Passed:
Failed:
Blocked:
Provider/CLI versions (no secrets):
Logs/screenshots:
Notes:
```

Final exit requires:

- [ ] Voice matrix passed on macOS and Windows for required rows.
- [ ] Usage daemon/provider/alert matrix passed with app closed and reopened.
- [ ] Cursor, OpenRouter, and NanoGPT live UI paths passed where credentials exist.
- [ ] Reasoning matrix passed through persisted UI, not fixtures alone.
- [ ] Track C deep-count and discoverability cases passed.
- [ ] `npm run check`, strict TypeScript gate, and strict OpenSpec validation pass.
- [ ] Status docs and OpenSpec tasks match actual evidence and known limitations.

Current evidence does not include paid OpenRouter/NanoGPT provider runs or the
packaged macOS/Windows matrices. Keep those rows unchecked.

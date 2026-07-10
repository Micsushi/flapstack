# Stage 2 Follow-ups

Open items surfaced while wiring up the Stage 2 worktrees. Small fixes are already
applied in their worktrees; the items below still need real work or a decision.

## Bigger tasks

### B1 — Whisper "download on first use" (voice-io) — P1

`stt-whisper-cpp.ts::ensureModel()` throws when the base model is missing, but the
proposal specs download-on-first-use. Needs:

- Streaming download of `ggml-base.bin` (~140 MB) to the speech data dir, with
  resume/retry and a checksum/size integrity check.
- Progress + cancel in the voice settings tab.
- Concurrency guard so app + daemon don't download at once.
- Honest failure state when offline / blocked.
  Track A / V2. Don't auto-download without UI.

### B2 — Voice adapter selection is not strict (voice-io) — P2

`resolveAvailableSttAdapter` silently falls back to cloud Whisper when the chosen
Local Whisper is unavailable — for a local-first app that can ship mic audio to the
cloud without the user knowing. Needs a decision + UI:

- Is an explicit engine choice a hard constraint or a preference?
- If preference: show a "Local Whisper unavailable — using cloud" banner and
  honor a `preferOffline` hard-block. Ties to V9.

### B3 — Create-branch no longer switches to the new branch (main) — decision

`createBranch` creates without switching (`branches.ts:121`). The header edit
replaced the post-create `checkout` with `refetchBranches()`, so creating a branch
now leaves you on the old branch. Left as-is (looks intentional). Decide:

- switch-on-create (restore the one-line `checkoutMutation`), or
- create-without-switch (keep, but update dialog copy).

### B4 — Native-module ABI toggle removal (main) — P1 blocker

Task 0.1 (F2) is the prerequisite so `npm run check` runs cleanly across every
track. Finish it before trusting any track's `check` gate.

### B5 — Overlapping tracks on divergent bases — integration risk

`main`, `mvp-ui-cleanup`, and `voice-io` all rewrite `agents-content.tsx` /
`agents-sidebar.tsx` incompatibly; `dev-mcp-test-control` is committed on the old
`cce69ed` base. Order:

- Land `main`'s scope + open-chat-tab work first.
- Rebase `mvp-ui-cleanup` and `voice-io` onto it, resolve the shared files once,
  re-run `check`.
- Rebase `dev-mcp-test-control` onto current `main` before reviewing it.

## Test gaps

- Open-chat tab strip + scope view (main).
- Voice stop/abort/strict-selection paths (voice-io).
- `check-codex-model-catalog.mjs` drift script.
- Full `npm run test` / `build` per worktree.

# Change: Stage 2 - Voice, Usage Tracking, Cursor, OpenRouter, and NanoGPT

## Why

Stage 1 (workspace core) is complete and archived. Stage 2 adds the next
local-first product slice: talk-to-your-agent voice I/O, usage/limits tracking,
Cursor integration on both surfaces (usage monitoring + a `cursor-agent` coding
harness), and OpenCode-backed harness support for OpenRouter and NanoGPT.
Architecture decisions were closed in the S2.0 grill-me gate (2026-07-09), then
Stage 2 was extended to cover OpenRouter/NanoGPT in the same adapter push.

## What Changes

- **Voice I/O (`voice-io`)**: bundled warm local streaming STT using Parakeet
  Unified EN by default, with committed/tentative text written directly into
  the active chat input while the user speaks, persisted transcript and local
  recording history, and whisper.cpp retained as an explicit multilingual
  fallback (no cloud STT in this stage); offline Kokoro TTS with system
  voice fallback, model-independent read-aloud derived after reply completion,
  and application-owned caveman full plus ponytail full agent defaults. No
  per-reply summarization LLM call.
- **Usage tracking (`usage-tracking`)**: replace `onWatch` with a shared
  TypeScript usage engine, background daemon, shared SQLite history, startup
  catch-up/manual refresh, Discord webhook alerts, and a top-level Usage
  dashboard tab. The daemon polls providers and sends alerts while the Flapstack
  UI is closed. Providers include general Codex/OpenAI and Claude/Anthropic
  account usage where APIs/credentials allow it, Cursor via the onWatch local
  token client, and OpenRouter/NanoGPT run usage plus cost/balance reconciliation
  where provider APIs allow it. Exact, provider-reported, estimated, and unknown
  cost data are labeled distinctly.
- **Cursor harness (`cursor-harness`)**: run the `cursor-agent` CLI as a
  first-class coding harness alongside Codex and Claude Code via a stream-json
  child-process adapter (Claude-style, not ACP), with run records/checkpoints/
  manifests, a teal identity chip, and honest permission-mode degradation.
- **OpenCode-backed API harnesses (`direct-api-harness`)**: run OpenRouter and
  NanoGPT through a Flapstack-managed local OpenCode sidecar. Flapstack owns
  launch/auth/config, model catalog/key storage, event normalization, approval
  bridge, usage capture, run records, checkpoints, and manifests; OpenCode owns
  provider streaming and the model/tool continuation loop.
- **Cross-provider reasoning controls**: add one per-chat Reasoning toggle,
  enabled by default. When enabled, map the selected model effort to the closest
  provider-supported reasoning depth and request the richest provider-supported
  visible reasoning output. When disabled, disable provider reasoning for that
  chat where supported and suppress reasoning output where it cannot be disabled.
- **Track C fixes** (native-module ABI toggle, create-branch dialog, terminal
  actions, sidebar remote-stats, strict-TS debt) are debt/bug work tracked on the
  Stage 2 board; they restore/complete intended behavior and carry no spec deltas
  here.

## Impact

- Affected specs (new capabilities): `voice-io`, `usage-tracking`,
  `cursor-harness`, `direct-api-harness`.
- Affected code:
  - `src/main/lib/speech/*`, native streaming STT sidecar and package resources,
    `src/main/lib/trpc/routers/{speech,voice}.ts`, `chat-input-area.tsx`, voice
    settings and dictation-history UI, and `voice_artifacts` storage.
  - `src/main/lib/usage/*` (new), `src/main/lib/db/schema` (+ migration), new
    Usage tab + settings, background usage daemon.
  - `src/shared/harness-types.ts`, `src/shared/model-catalog.ts`,
    `src/main/lib/trpc/routers/cursor.ts` (new), `runs.ts`, `permissions.ts`.
  - `src/main/lib/trpc/routers/opencode.ts` (new),
    `src/main/lib/harness/opencode-sidecar/*` (new), model/key settings, shared
    stream normalizers.
- New/verified externals: MIT transcribe.cpp sidecar, Parakeet Unified EN model,
  whisper.cpp fallback binary+model, Kokoro model, Cursor usage
  endpoints (undocumented, best-effort), `cursor-agent` CLI (must be installed +
  its surface verified before the adapter - see design/D0), OpenAI usage/cost
  APIs, Anthropic Admin usage/cost APIs, OpenRouter API, NanoGPT API, Discord
  webhooks.
- Prerequisite: fix the native-module ABI toggle (Track C F2) first so the full
  `npm run check` gate runs cleanly for every track.

## Reference

- Tracking: this OpenSpec change plus machine-local `STAGE2-*-TRACK.md` planning
  notes kept outside this repository cover tracks V/U/D/E/T/F,
  per-task files, done criteria, and resolved S2.0 decisions.
- Reuse repos: `agent-hotline` (filter + TTS engines), `onWatch` (usage math,
  storage, notification model, Discord sender, dashboard references, and full
  Cursor usage client). External docs checked 2026-07-09/10: OpenAI usage/cost
  APIs; Anthropic Admin usage/cost APIs; OpenRouter OpenAI-compatible chat API,
  usage accounting, generation stats, key credits/limits, and reasoning docs;
  NanoGPT OpenAI-compatible chat API, models/pricing, and reasoning-output docs;
  Discord webhook docs.

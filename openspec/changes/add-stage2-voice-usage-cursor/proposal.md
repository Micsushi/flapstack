# Change: Stage 2 — Voice, Usage Tracking, and Cursor Integration

## Why

Stage 1 (workspace core) is complete and archived. Stage 2 adds the next
local-first product slice: talk-to-your-agent voice I/O, usage/limits tracking,
and Cursor integration on both surfaces (usage monitoring + a `cursor-agent`
coding harness). Architecture decisions were closed in the S2.0 grill-me gate
(2026-07-09).

## What Changes

- **Voice I/O (`voice-io`)**: local whisper.cpp STT (`base` multilingual,
  download-on-first-use; cloud Whisper secondary), offline Kokoro TTS with system
  voice fallback, and harness-authored `Spoken:`/`Displayed:` read-aloud with a
  non-LLM fallback. No per-reply summarization LLM call.
- **Usage tracking (`usage-tracking`)**: main-process interval pollers (default
  5-min, configurable) for Anthropic, Codex, and Cursor; SQLite history; threshold
  alerts; a new top-level Usage dashboard tab. Cursor uses a three-source fallback
  chain, shipping source 1 (internal endpoints, local-token auto-detect) with
  sources 2 (admin API) and 3 (CLI) as stubbed chain slots.
- **Cursor harness (`cursor-harness`)**: run the `cursor-agent` CLI as a
  first-class coding harness alongside Codex and Claude Code via a stream-json
  child-process adapter (Claude-style, not ACP), with run records/checkpoints/
  manifests, a teal identity chip, and honest permission-mode degradation.
- **Track C fixes** (native-module ABI toggle, create-branch dialog, terminal
  actions, sidebar remote-stats, strict-TS debt) are debt/bug work tracked on the
  Stage 2 board; they restore/complete intended behavior and carry no spec deltas
  here.

## Impact

- Affected specs (new capabilities): `voice-io`, `usage-tracking`,
  `cursor-harness`.
- Affected code:
  - `src/main/lib/speech/*`, `src/main/lib/trpc/routers/{speech,voice}.ts`,
    `chat-input-area.tsx`, new voice settings tab.
  - `src/main/lib/usage/*` (new), `src/main/lib/db/schema` (+ migration), new
    Usage tab + settings.
  - `src/shared/harness-types.ts`, `src/shared/model-catalog.ts`,
    `src/main/lib/trpc/routers/cursor.ts` (new), `runs.ts`, `permissions.ts`.
- New/verified externals: whisper.cpp binary+model, Kokoro model, Cursor usage
  endpoints (undocumented, best-effort), `cursor-agent` CLI (must be installed +
  its surface verified before the adapter — see design/D0).
- Prerequisite: fix the native-module ABI toggle (Track C F2) first so the full
  `npm run check` gate runs cleanly for every track.

## Reference

- Vault board: `Wiki/Projects/flapstack/stage2-implementation-tasks.md`
  (tracks V/U/D/F, per-task files + done-when, S2.0 resolved decisions).
- Reuse repos: `agent-hotline` (filter + TTS engines), `onWatch` (usage math +
  full Cursor usage client).

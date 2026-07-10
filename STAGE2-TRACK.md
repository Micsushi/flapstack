# Stage 2 — Track A: Voice (STT/TTS)

Branch: `codex/stage2-voice-io`

Authoritative task board (Blocked-by / Blocks / Files / Scope / Done-when for
every task):
`agentsvault/Wiki/Projects/flapstack/stage2-implementation-tasks.md` → **Track A**.

## Tasks

- V1 Speech adapter interfaces + settings (fill scaffold)
- V2 STT: whisper.cpp local + cloud hardening
- V3 TTS: system voice — macOS
- V4 TTS: system voice — Windows (parallel with V3)
- V5 TTS: offline Kokoro engine
- V6 Spoken/Displayed separation pipeline (harness-authored, no LLM summarize)
- V7 Voice UX: mic capture + read-aloud controls
- V8 Voice settings tab
- V9 OS mic permissions + honest failure states
- V-exit Voice track tests + manual matrix

Start: V1 → V2/V3/V4/V8/V9 → V5/V6 → V7 → V-exit.

## Cross-branch coupling

- Mostly self-contained. Reuse source: `agent-hotline` (speakable-filter, native
  TTS, Kokoro). No hard deps on other Stage 2 branches.

## Base

Off `main` @ 4a2fab7 (== origin/main). Rebase on main before merge.

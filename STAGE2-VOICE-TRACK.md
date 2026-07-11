# Stage 2 — Track A: Voice (STT/TTS)

Branch: `codex/stage2-voice-io`

Repo-local implementation scope: **Track A**.

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

Rebased onto `main` at `ed5008c` on 2026-07-10. The root `STAGE2-TRACK.md` is
owned by the Cursor track after its merge; this file preserves the Voice track
notes without overwriting that shared path.

## Recovery status

- V1–V9 are implemented in this worktree. The OpenSpec checklist records those
  completed implementation tasks.
- Voice migration moved to `0010_voice_artifacts` after main added its own
  `0009` migration.
- Automated exit coverage: the full Node 24 suite passed 212 tests with 3
  opt-in tests skipped; full ESLint,
  targeted Prettier, strict OpenSpec validation, diff checks, and the production
  build passed.
- Live macOS Electron smoke passed: Local Whisper and its 141 MB base model were
  detected, WebM microphone capture transcribed locally into the editor without
  sending, dictation history persisted, Kokoro and Native OS preview requests
  completed without runtime errors, Stop worked, and the per-chat read-aloud
  toggle persisted both directions.
- Read-aloud now injects the Spoken/Displayed instruction into Claude, Codex,
  and Cursor; resolved spoken text persists on assistant message metadata; one
  renderer-wide playback owner prevents overlapping speech.
- V-exit remains open for the manual Electron matrix in
  `docs/voice-manual-matrix.md`, including both OS microphone permission and
  human-audible native/Kokoro playback checks. Windows still requires a real
  Windows machine. Do not mark those boxes without a real device run.

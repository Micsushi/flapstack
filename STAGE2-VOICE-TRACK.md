# Stage 2 — Track A: Voice (STT/TTS)

Historical branch: `codex/stage2-voice-io` (merged into `main`)

This file is the authoritative repo-local task board for **Track A**, including
dependencies, file scope, and done criteria.

## Integrated readiness correction — 2026-07-10

The Voice implementation and review hardening are integrated on `main`. The mic
now stays discoverable on first use, model download/progress/retry is exposed,
playback has a single cancellable owner, stale synthesis is discarded, and the
read-aloud contract covers Claude, Codex, Cursor, OpenRouter, and NanoGPT. Current
manual rows live in `docs/stage2-full-feature-test-matrix.md`.

Prepared macOS development is testable. A pristine packaged app still depends on
system `whisper-cli` and FFmpeg because those executables are not bundled.
Human-audible macOS checks, Windows SAPI/microphone checks, and packaged DMG/Windows
tests remain Stage 2 exit blockers.

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

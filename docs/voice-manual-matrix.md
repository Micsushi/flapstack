# Stage 3 Voice manual verification matrix (S3-F9)

Run this matrix from a packaged or development Electron build after the
automated suite passes. Mark only paths actually verified on the target OS.

| Scenario                    | Expected result                                                                                                 | macOS | Windows |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- | ----- | ------- |
| Parakeet model absent       | Honest absent/downloading/error state; explicit user action starts one pinned model download                    | [ ]   | [ ]     |
| Parakeet streaming          | Warm sidecar emits tentative then committed text with cancellation and idle-unload behavior                     | [ ]   | [ ]     |
| Composer insertion          | Tentative text updates in place; committed text remains reviewable and is never auto-sent                       | [ ]   | [ ]     |
| Origin safety               | Recording survives navigation, returns to its immutable conversation origin, and never writes into another chat | [ ]   | [ ]     |
| Whisper fallback            | Explicit fallback uses bundled batch Whisper, labels the engine, and never silently uploads to cloud            | [ ]   | [ ]     |
| Microphone denied/no device | Actionable OS-specific recovery appears; late-start streams are cancelled after release or blur                 | [ ]   | [ ]     |
| Voice History persistence   | Final transcript/metadata and optional WAV survive restart and are searchable                                   | [ ]   | [ ]     |
| Voice History actions       | Copy, insert into the selected composer, play, reveal, and delete act on the chosen record only                 | [ ]   | [ ]     |
| Native voice                | Preview and message/history playback use the selected voice/rate; Stop interrupts immediately                   | [ ]   | [ ]     |
| Kokoro                      | Offline synthesis works without an API key and falls back visibly to a compatible native voice                  | [ ]   | [ ]     |
| Manual playback             | No composer/global automatic read-aloud controls exist; per-message and history Play remain available           | [ ]   | [ ]     |
| Interruption                | New playback or Stop cancels stale native/Kokoro output without replaying chat history                          | [ ]   | [ ]     |
| Restart persistence         | Adapter/model, offline preference, voice, rate, history, and model readiness restore honestly                   | [ ]   | [ ]     |

Automated coverage must include adapter resolution, Parakeet protocol/lifecycle,
Whisper fallback, origin-bound composer updates, history CRUD, settings
migration, Kokoro WAV helpers, native voice parsing, and playback interruption.
Prompt injection and automatic read-aloud are removed behavior, not exit goals.

## 2026-07-13 closeout candidate evidence

- Candidate: `821c9cd2fa24849ba605c26dc0b5a896e1bafd68` on
  `codex/s3-f9-voice-closeout`, reconciled with the integrated Voice
  implementation at `73a8347`.
- Node 22 focused Voice suite: 8 files, 84 tests passed.
- Rust sidecar suite: 3 protocol/PCM tests passed.
- Pinned model SHA-256 matched
  `4b50b6dd862bf6e346929aaf4f5eaacec003bfa3f56462d6c874b41ef2f38795`.
- The current release sidecar accepted eight 32 KiB synthetic-speech chunks,
  produced ordered committed updates, finalized as
  `Flapstack voice streaming works with committed and tentative text`, and
  unloaded explicitly. The short sample emitted no tentative suffix.
- Strict OpenSpec validation passed for `complete-settings-reliability`.
- `npm run dev:verify` passed for this exact checkout and the `Flapstack Dev`
  profile; startup completed migrations and loaded the main window. The Dev
  instance was then stopped cleanly and its UI lease released.
- Authenticated renderer control opened Settings on the Voice tab, but exact
  window capture failed with ScreenCaptureKit `SCStreamErrorDomain` code `-3811`
  (`Failed to start stream due to audio/video capture failure`), followed by
  Computer Use error `-10005` (`noWindowsAvailable`). Capture was black while
  the accessibility tree remained stale. The attempt was bounded; no visual,
  microphone, composer, history-action, or playback row is claimed.
- The current arm64 `Flapstack Preview.app` package built successfully without a
  signing identity. Inspection and smoke passed for arm64 Electron, Claude
  `2.1.207`, Codex `0.144.1`, Whisper, the Parakeet sidecar ping protocol,
  better-sqlite3, and all three native speech license files. Packaged-app UI
  launch remains unverified.
- The current Node 22 full gate passed lint, formatting, TypeScript, tests, and
  the production build.
- Windows and Linux manual/package rows remain unavailable and unchecked.

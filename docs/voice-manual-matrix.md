# Stage 3 Voice manual verification matrix (S3-F9)

Run this matrix from a packaged or development Electron build after the
automated suite passes. Mark only paths actually verified on the target OS.

| Scenario                    | Expected result                                                                                                 | macOS | Windows |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- | ----- | ------- |
| Parakeet model absent       | Honest absent/downloading/error state; explicit user action starts one pinned model download                    | [x]   | [ ]     |
| Parakeet streaming          | Warm sidecar emits tentative then committed text with cancellation and idle-unload behavior                     | [x]   | [ ]     |
| Composer insertion          | Tentative text updates in place; committed text remains reviewable and is never auto-sent                       | [x]   | [ ]     |
| Origin safety               | Recording survives navigation, returns to its immutable conversation origin, and never writes into another chat | [x]   | [ ]     |
| Whisper fallback            | Explicit fallback uses bundled batch Whisper, labels the engine, and never silently uploads to cloud            | [x]   | [ ]     |
| Microphone denied/no device | Actionable OS-specific recovery appears; late-start streams are cancelled after release or blur                 | [x]   | [ ]     |
| Voice History persistence   | Final transcript/metadata and optional WAV survive restart and are searchable                                   | [x]   | [ ]     |
| Voice History actions       | Copy, insert into the selected composer, play, reveal, and delete act on the chosen record only                 | [x]   | [ ]     |
| Native voice                | Preview and message/history playback use the selected voice/rate; Stop interrupts immediately                   | [x]   | [ ]     |
| Kokoro                      | Offline synthesis works without an API key and falls back visibly to a compatible native voice                  | [x]   | [ ]     |
| Manual playback             | No composer/global automatic read-aloud controls exist; per-message and history Play remain available           | [x]   | [ ]     |
| Interruption                | New playback or Stop cancels stale native/Kokoro output without replaying chat history                          | [x]   | [ ]     |
| Restart persistence         | Adapter/model, offline preference, voice, rate, history, and model readiness restore honestly                   | [x]   | [ ]     |

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

The former three-test MCP migration mismatch is resolved on the integration
baseline. It no longer blocks S3-F9; the manual rows above remain open.

## 2026-07-13 integrated-candidate continuation

Authenticated MCP read the bounded live Voice surface and production settings,
reported the selected local Parakeet/Kokoro adapters, and returned history
counts without transcript text. A rate mutation used the production setter and
was restored to `1`. No microphone, native dialog, playback, audio retention,
or Windows behavior was exercised, so S3-F9-T1 through S3-F9-T5 remain open.

## 2026-07-14 integrated macOS completion

- The user completed real microphone dictation after the pinned model finished
  provisioning. The exact isolated profile then checksum-validated the same
  731,357,568-byte Parakeet model and reported the warm streaming adapter ready.
- Real Parakeet streaming consumed 236,136 bytes of 16 kHz float PCM and
  finalized exactly `Flapstack voice streaming works with committed and
tentative text`. The bundled Whisper fallback independently transcribed the
  same local audio without any network adapter.
- The mounted Voice page passed history search, exact clipboard copy, local WAV
  playback, UI deletion, Kokoro preview/Stop, native preview/Stop, and rate
  persistence. The test-control fallback exposed and fixed full-page Settings
  insertion; the repaired action returned to the selected composer and inserted
  exactly once. A retained fixture row plus audio survived an app restart and
  was then deleted through its bounded cleanup control.
- Permission-denied/late-start recovery, immutable origin, tentative revision,
  fallback labeling, interruption, invalid values, and missing-target copy are
  covered by the focused renderer/recording/lifecycle suites. Windows remains
  explicitly deferred to the end of Stage 4.

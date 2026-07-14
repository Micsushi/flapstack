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

## 2026-07-13 lane evidence

- Node 22 focused Voice suite: 7 files, 82 tests passed.
- Rust sidecar suite: 3 protocol/PCM tests passed.
- Pinned model SHA-256 matched
  `4b50b6dd862bf6e346929aaf4f5eaacec003bfa3f56462d6c874b41ef2f38795`.
- Real release sidecar with that model passed load, start, one second of 16 kHz
  float PCM feed, finalize, and unload.
- Real chunked synthetic speech produced ordered committed updates and finalized
  as `Flapstack voice streaming works with committed and tentative text`; the
  sidecar emitted no tentative suffix for this short sample.
- Strict OpenSpec validation passed for `complete-settings-reliability`.
- The former three-test MCP migration mismatch is resolved on
  `codex/stage3-integration`. The current Node 22 full gate passes lint,
  formatting, TypeScript, tests, and the production build. This historical lane
  blocker no longer blocks S3-F9; only the manual rows below remain open.
- `npm run dev:verify` passed for this checkout and the `Flapstack Dev` profile;
  startup completed migrations and loaded the main window.
- The arm64 `Flapstack Preview.app` package built successfully. Inspection and
  smoke passed for arm64 Electron, Claude `2.1.207`, Codex `0.144.1`, Whisper,
  the Parakeet sidecar ping protocol, better-sqlite3, and all three native speech
  license files.
- Manual UI rows remain unchecked because the macOS session was locked during
  this run. No microphone, composer, history-action, or playback behavior is
  claimed from the headless evidence above.

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

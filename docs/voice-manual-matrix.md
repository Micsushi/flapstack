# Voice manual verification matrix

Run this matrix from a packaged or development Electron build after the
automated suite passes. Mark only paths actually verified on the target OS.

| Scenario                       | Expected result                                                                                          | macOS | Windows |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | ----- | ------- |
| Local dictation, model absent  | Clear binary/model state; model download starts only after a usable whisper.cpp binary is configured     | [ ]   | [ ]     |
| Local dictation, model present | Transcript is inserted into the editor, is not auto-sent, and says `Dictated with Local Whisper`         | [ ]   | [ ]     |
| Browser audio conversion       | WebM or M4A recording transcribes after local FFmpeg conversion                                          | [ ]   | [ ]     |
| Local selected, unavailable    | No cloud upload or cloud fallback; the UI says what local prerequisite is missing                        | [ ]   | [ ]     |
| Microphone denied              | Permission error names microphone access and gives an actionable OS recovery step                        | [ ]   | [ ]     |
| No microphone                  | Clear `No microphone found` state                                                                        | [ ]   | [ ]     |
| Native voice                   | Preview creates audible speech; Stop interrupts ongoing synthesis/playback                               | [ ]   | [ ]     |
| Kokoro                         | First model download succeeds, speech works with no API key, and Native OS voice is used if Kokoro fails | [ ]   | [ ]     |
| Read aloud, Claude             | New reply has its `Spoken:` block read; no code or displayed detail is read                              | [ ]   | [ ]     |
| Read aloud, Codex              | New reply has its `Spoken:` block read; no code or displayed detail is read                              | [ ]   | [ ]     |
| Read aloud off                 | No automatic playback; per-message Play remains available                                                | [ ]   | [ ]     |
| Interrupt                      | Starting a new reply or pressing Stop stops current audio and does not replay chat history               | [ ]   | [ ]     |

Automated coverage: adapter selection and fallback, settings normalization,
spoken-text filtering, Kokoro WAV helpers, native voice parsing, and read-aloud
prompt injection live in `tests/voice-speech.test.ts`.

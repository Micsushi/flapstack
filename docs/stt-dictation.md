# STT and standalone dictation

This guide records the standalone dictation setup and the proposed
cross-platform STT direction for Flapstack.

## Status

- Standalone recommendation: Handy `v0.9.1`.
- Required platforms: macOS, Windows, and Linux.
- Required transcript delivery: final-only and live-revising.
- Flapstack target: one owned Rust sidecar across all three platforms.
- Current approved OpenSpec still uses whisper.cpp `base`.

The sidecar and model change is research, not approved implementation scope.
Revise and approve the existing Stage 2 OpenSpec before replacing whisper.cpp.

## Standalone use now

[Handy](https://github.com/cjpais/Handy) is the supported standalone choice.
It is free, MIT-licensed, local, and ships macOS, Windows, and Linux releases.

### macOS

```bash
brew install --cask handy
```

Grant:

- Microphone permission for recording.
- Accessibility permission for pasting into the active application.

`Fn+Space` works through Handy's `handy-keys` backend on macOS. Select
push-to-talk and hold the shortcut while speaking.

### Windows

```powershell
winget install cjpais.Handy
```

Grant microphone access in Windows Privacy settings. Use `Ctrl+Space` or
another global shortcut; do not depend on the hardware Fn key.

### Linux

Download the AppImage, `.deb`, or `.rpm` from the Handy releases page.

```bash
sudo apt install ./Handy_*.deb
# or
sudo dnf install ./Handy-*.rpm
# or
chmod +x Handy_*.AppImage && ./Handy_*.AppImage
```

Linux notes:

- Use `Ctrl+Space` or `Alt+Space`; Fn is not a portable Linux modifier.
- Wayland text insertion may require `wtype` or `dotool`.
- Some distributions require the `gtk-layer-shell` runtime package.
- Keep the live overlay disabled if the compositor lets it steal focus from the
  application that should receive the final paste.

## Model choices

| Need                    | Model                         | Notes                                                        |
| ----------------------- | ----------------------------- | ------------------------------------------------------------ |
| English final + live    | Parakeet Unified EN 0.6B GGUF | One model supports offline and streaming inference.          |
| Multilingual live       | Nemotron Streaming 3.5 GGUF   | Distribution requires OpenMDW 1.1 review.                    |
| Multilingual final-only | Parakeet TDT 0.6B v3          | Fast batch path; no true live updates in Handy's ONNX route. |
| Compatibility           | Whisper GGUF/GGML             | Broad language support; keep as fallback.                    |

Prefer a quantized model on lower-memory machines. Model downloads must have
progress, cancellation, integrity checks, and explicit license attribution.

## Transcript delivery modes

Delivery and cleanup are separate settings.

### Final-only

```text
capture audio -> transcribe/finalize -> display complete text
```

Partial hypotheses stay hidden. Releasing push-to-talk finalizes the stream and
places the complete transcript into the input.

### Live-revising

```text
committed prefix + replaceable tentative suffix
```

- Committed text is append-only.
- Tentative text may change as more audio arrives.
- A newer hypothesis replaces only the prior tentative range.
- Finalization commits the remaining suffix.

Flapstack can update its own editor safely. Standalone Handy should show live
text in its overlay and paste the finalized text into third-party applications.
Continuously rewriting arbitrary external text fields is not reliable across
applications, accessibility APIs, X11, and Wayland.

## Cleanup modes

- **Raw:** model output with whitespace normalization.
- **Clean:** deterministic punctuation, filler, number, dictionary, and word
  replacement rules.
- **Rewrite:** optional local or cloud LLM cleanup; retain the raw transcript.

Default agent prompts to Clean. Never require cloud cleanup for local STT.

## Dynamic project vocabulary

Flapstack owns a scoped vocabulary pipeline; Handy and the STT sidecar consume
the resulting terms.

Candidate sources:

- project and repository names
- branch and worktree names
- file and folder basenames
- package and dependency names
- harness and model names
- repeated recent prompt terms
- explicit user corrections and pinned words

Activation policy:

- Trusted project metadata activates automatically.
- Terms inferred from transcripts remain suggestions until the user approves.
- Approved terms persist per project; pinned global terms apply everywhere.
- Session terms expire unless promoted.

Before storage, reject secrets, tokens, emails, hashes, UUIDs, high-entropy
strings, and common-language noise. Do not scan arbitrary source-file contents.
Rank remaining candidates by source trust, frequency, recency, casing, and
correction history. Bound each adapter's active list and send highest-value
terms first.

Application order:

1. Pass keyword bias or decode prompts when the selected engine supports them.
2. Otherwise apply deterministic fuzzy replacement to tentative and final text.
3. Keep committed live text stable; replace the complete dictation range with
   the cleaned final result at finalization when needed.
4. Preserve raw text and correction metadata in history.

User controls must show active and suggested terms with source, scope, and last
use. Support approve, pin, edit, disable, and delete. Every automatic correction
must be reversible; no LLM is required for this pipeline.

## Flapstack target architecture

```text
Electron renderer
-> 16 kHz mono PCM over binary IPC
-> Flapstack-owned Rust sidecar
-> warm transcribe.cpp/transcribe-rs session
-> committed/tentative/final events
-> Flapstack editor
```

Required sidecar operations:

- `prepare`
- `start`
- `appendPcm`
- `finalize`
- `cancel`
- `unload`

Required result metadata:

- raw and processed text
- adapter and model ID
- detected language
- confidence when exposed
- audio duration and processing time
- committed/tentative/final state

Keep strict engine selection. Never send microphone audio to cloud because a
local engine is missing.

## Dependency inventory

| Repository                                                                        | Flapstack use                                               |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| [cjpais/Handy](https://github.com/cjpais/Handy)                                   | Standalone app and MIT lifecycle/UI architecture reference. |
| [handy-computer/transcribe.cpp](https://github.com/handy-computer/transcribe.cpp) | Cross-platform GGUF inference and true streaming sessions.  |
| [cjpais/transcribe-rs](https://github.com/cjpais/transcribe-rs)                   | ONNX batch models such as Parakeet TDT v3.                  |
| [handy-computer/handy-keys](https://github.com/handy-computer/handy-keys)         | Cross-platform global shortcut behavior.                    |
| [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp)                   | Compatibility fallback.                                     |

Do not depend on local temporary clone paths. Pin reviewed versions when the
OpenSpec change is approved.

## License boundary

| Component                                   | Boundary                                               |
| ------------------------------------------- | ------------------------------------------------------ |
| Handy                                       | MIT; reusable with notice preservation.                |
| transcribe.cpp / transcribe-rs / handy-keys | Verify the pinned release licenses before vendoring.   |
| whisper.cpp                                 | MIT.                                                   |
| Parakeet TDT v3 weights                     | CC BY 4.0; attribution required.                       |
| Parakeet Unified EN weights                 | NVIDIA Open Model License; review before distribution. |
| Nemotron Streaming 3.5 weights              | OpenMDW 1.1; review before distribution.               |
| FluidVoice, TypeWhisper, VoiceInk           | GPLv3; study or process/API boundary only.             |

## Acceptance gate

Test a packaged build on real macOS, Windows, and Linux machines. For each OS,
verify:

- install, launch, model download, and restart
- microphone permission granted and denied states
- push-to-talk press, release, and cancel
- final-only delivery
- live committed/tentative correction
- trusted project terms activate automatically
- inferred transcript terms require approval
- secret-like candidates are rejected
- raw and corrected text remain inspectable
- transcript insertion without auto-send
- no silent cloud or engine fallback
- model unload/reload and low-memory behavior
- active-app paste for standalone Handy

Linux must cover at least one X11 and one Wayland session. Mark support complete
only after the real platform matrix passes.

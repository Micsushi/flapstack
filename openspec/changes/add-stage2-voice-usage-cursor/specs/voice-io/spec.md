## ADDED Requirements

### Requirement: Local Speech-to-Text

The system SHALL provide local-only batch dictation via a bundled whisper.cpp
`SttAdapter` using a user-selectable pinned `tiny`, `base`, or `small`
multilingual model downloaded on first use, and SHALL surface that Local Whisper
transcribed each utterance. Browser microphone audio SHALL be converted to 16
kHz mono PCM WAV before entering the main process so packaged dictation does not
depend on a system FFmpeg install.

#### Scenario: Offline dictation

- **WHEN** the user dictates
- **THEN** the whisper.cpp adapter transcribes the audio locally
- **AND** the resulting transcript is placed in the chat input for review

#### Scenario: Model not yet downloaded

- **WHEN** the user starts dictation before the whisper.cpp model is present
- **THEN** the system downloads the model with visible progress
- **AND** shows an actionable state on download failure rather than a silent no-op

#### Scenario: Pristine packaged dictation

- **WHEN** a user installs a packaged build on a supported target without Homebrew,
  FFmpeg, or whisper.cpp already installed
- **THEN** Flapstack uses its bundled checksum-pinned whisper.cpp engine
- **AND** downloads only the selected model with visible lifecycle state

#### Scenario: User changes model

- **WHEN** the user selects tiny, base, or small in Voice settings
- **THEN** status and download progress apply to that model independently
- **AND** existing downloads for other model sizes remain available

### Requirement: Offline Text-to-Speech

The system SHALL provide read-aloud via an offline Kokoro `TtsAdapter` by default
with the OS system voice as a fallback, honoring one active utterance per window
where `stop()` cancels and a new speak request preempts.

#### Scenario: Read a reply aloud offline

- **WHEN** read-aloud is enabled and no TTS API key is configured
- **THEN** the reply is spoken using the offline Kokoro voice

#### Scenario: Kokoro model unavailable

- **WHEN** the Kokoro model is missing
- **THEN** the system falls back to the OS system voice
- **AND** read-aloud still speaks without a cloud dependency

### Requirement: Spoken and Displayed Read-Aloud

The system SHALL read aloud a listener-ready `Spoken:` section authored by the
harness (prompted via a Flapstack read-aloud skill/instruction) by extracting it
with the ported speakable filter, and SHALL fall back to a non-LLM summary only
when a reply contains no `Spoken:` section, making no additional model call for
the spoken text.

#### Scenario: Reply contains a Spoken section

- **WHEN** read-aloud is on and the harness reply includes a `Spoken:` section
- **THEN** only the `Spoken:` content is read aloud, with code, diffs, tables, and
  logs excluded

#### Scenario: Reply has no Spoken section

- **WHEN** read-aloud is on and the reply has no `Spoken:` section
- **THEN** the non-LLM fallback summary is spoken
- **AND** no extra model call is made to generate it

### Requirement: Voice Capture Controls

The system SHALL provide a mic control in the chat input supporting push-to-talk
hold and click-to-toggle, place the transcript in the input for review without
auto-sending, and offer a per-chat read-aloud toggle with a global default.

#### Scenario: Dictate and review before sending

- **WHEN** the user holds the mic control and speaks
- **THEN** a recording indicator is shown
- **AND** on release the transcript appears in the input without being sent

#### Scenario: Interrupt read-aloud

- **WHEN** a reply is being spoken and the user presses stop
- **THEN** speech stops immediately

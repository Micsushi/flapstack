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

- **WHEN** the user clicks a message speaker control and no TTS API key is configured
- **THEN** the reply is spoken using the offline Kokoro voice

#### Scenario: Kokoro model unavailable

- **WHEN** the Kokoro model is missing
- **THEN** the system falls back to the OS system voice
- **AND** read-aloud still speaks without a cloud dependency

### Requirement: Model-Independent Read-Aloud

The system SHALL keep read-aloud independent from agent skills and model output
formatting. Enabling TTS SHALL NOT inject a read-aloud instruction or require the
harness to author `Spoken:` or `Displayed:` sections. Flapstack SHALL derive
speakable text from the completed reply without an additional model call.

#### Scenario: Reply contains a Spoken section

- **WHEN** a legacy or user-authored reply includes a `Spoken:` section
- **THEN** only the `Spoken:` content is read aloud, with code, diffs, tables, and
  logs excluded

#### Scenario: Reply has no Spoken section

- **WHEN** the user requests speech for a reply with no `Spoken:` section
- **THEN** the non-LLM fallback summary is spoken
- **AND** no extra model call is made to generate it

#### Scenario: Enabling TTS does not alter the reply

- **WHEN** the user clicks a message speaker control
- **THEN** Flapstack does not add a speech-format instruction to the harness prompt
- **AND** the displayed assistant reply retains its normal format

### Requirement: Default Agent Behavior

The installed application SHALL provide application-owned caveman full and
ponytail full instructions to every supported harness and every new chat by
default, even when no external skill or instruction file is installed.

#### Scenario: Fresh installation

- **WHEN** a user starts a chat on a fresh Flapstack installation
- **THEN** caveman full and ponytail full instructions are included in harness context
- **AND** this behavior does not depend on files under `.codex`, `.claude`, or a repository

#### Scenario: Cross-provider default

- **WHEN** a chat runs through Claude, Codex, Cursor, OpenRouter, or NanoGPT
- **THEN** the same application-owned caveman and ponytail defaults are supplied

### Requirement: Optional Machine-Local Vault Context

The system SHALL support an opt-in machine-local vault configuration outside the
repository and application package. When enabled, every harness SHALL preload the
vault startup file plus the matching project router and current handoff when they
exist. A missing or disabled configuration SHALL require no setup and SHALL NOT
prompt the user to connect a vault.

#### Scenario: Personal vault enabled

- **WHEN** a machine-local configuration enables an absolute vault root
- **THEN** new chats receive the vault `AGENTS.md`
- **AND** receive the matching project index and current handoff when present

#### Scenario: Normal installation has no vault

- **WHEN** the machine-local vault configuration is absent or disabled
- **THEN** Flapstack starts chats normally without vault context
- **AND** does not ask the user to configure or connect a vault

### Requirement: Voice Capture Controls

The system SHALL provide a mic control in the chat input supporting push-to-talk
hold and click-to-toggle, and place the transcript in the input for review
without auto-sending. Speech playback SHALL be requested manually from a message;
the composer SHALL NOT expose automatic or per-chat read-aloud controls.

#### Scenario: Dictate and review before sending

- **WHEN** the user holds the mic control and speaks
- **THEN** a recording indicator is shown
- **AND** on release the transcript appears in the input without being sent

#### Scenario: Interrupt read-aloud

- **WHEN** a reply is being spoken and the user presses stop
- **THEN** speech stops immediately

#### Scenario: Composer has no automatic read-aloud control

- **WHEN** the user opens a chat composer
- **THEN** no global, inherited, or per-chat read-aloud toggle is shown
- **AND** assistant replies are not spoken automatically

### Requirement: Read-Aloud Playback Controls

The system SHALL show compact inline playback controls beside the message speaker
button while speech is active, including a seekable progress bar, a playback-rate
bar, and smooth cumulative spoken-text highlighting derived from the exact text sent
to TTS. Highlight progress SHALL advance continuously within each rendered line.
Seeking SHALL update the highlight in both directions. Each message SHALL
retain its playback and highlight position while other messages play, including
the completed state at the end. Playback rate SHALL persist globally across projects
and chats. Voice settings SHALL retain a separate voice choice for each TTS provider.

#### Scenario: Control active speech

- **WHEN** a reply is being spoken
- **THEN** the user can seek within the audio and change its playback rate
- **AND** all words spoken through the seek position are highlighted
- **AND** playback resumes from the selected position

#### Scenario: Switch between message audio

- **WHEN** the user pauses one message, plays another, and returns to the first
- **THEN** each message retains its own progress and cumulative highlight
- **AND** a completed message remains at the end with all spoken words highlighted

#### Scenario: Reuse voice preferences

- **WHEN** the user changes playback rate or selects a voice for a TTS provider
- **THEN** the rate is reused across all chats and projects
- **AND** returning to that provider restores its own selected voice

## ADDED Requirements

### Requirement: Local Speech-to-Text

The system SHALL provide local-only streaming dictation through a bundled warm
native sidecar using Parakeet Unified EN by default. Browser microphone audio
SHALL enter the sidecar as 16 kHz mono PCM chunks. Each update SHALL contain an
append-only committed prefix and replaceable tentative suffix. The active chat
input SHALL display their combined text while the user speaks, without a
separate dictation overlay, and microphone release SHALL finalize the stream.
The system SHALL retain local whisper.cpp as an explicit selectable multilingual
fallback and SHALL never upload microphone audio through a silent fallback.

#### Scenario: Offline dictation

- **WHEN** the user dictates with the streaming engine selected
- **THEN** the warm Parakeet adapter transcribes the audio locally
- **AND** committed and tentative text fill the active chat input while speech continues
- **AND** release finalizes the text for review without sending it

#### Scenario: Model not yet downloaded

- **WHEN** the user starts dictation before the selected model is present
- **THEN** the system downloads the model with visible progress
- **AND** shows an actionable state on download failure rather than a silent no-op

#### Scenario: Pristine packaged dictation

- **WHEN** a user installs a packaged build on a supported target without Homebrew,
  FFmpeg, or whisper.cpp already installed
- **THEN** Flapstack uses its bundled checksum-pinned streaming sidecar
- **AND** downloads only the selected model with visible lifecycle state

#### Scenario: User selects the multilingual fallback

- **WHEN** the user selects Local Whisper and a tiny, base, or small model
- **THEN** status and download progress apply to that model independently
- **AND** existing downloads for other model sizes remain available

### Requirement: Dictation History

The system SHALL persist each finalized dictation as searchable local history
containing final transcript, engine, timestamps, duration, chat association,
and—when recording retention is enabled—the original WAV recording. Voice
settings SHALL allow the user to copy or insert text, play or reveal retained
audio, and delete an entry. Deleting an entry SHALL delete its owned audio file.

#### Scenario: Finalized dictation is saved

- **WHEN** a non-empty dictation is finalized
- **THEN** its transcript and metadata appear in Voice settings history
- **AND** its local recording is playable when recording retention is enabled

#### Scenario: Reuse an earlier transcript

- **WHEN** the user chooses copy or insert on a history entry
- **THEN** the exact finalized transcript is available for reuse

#### Scenario: Delete history safely

- **WHEN** the user confirms deletion of a dictation history entry
- **THEN** its database row and Flapstack-owned recording file are removed
- **AND** unrelated history and files remain untouched

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

### Requirement: Cross-Provider Reasoning Control

The system SHALL provide one per-chat Reasoning toggle beside model effort,
enabled by default. When enabled, the selected effort SHALL map to the closest
reasoning depth supported by the active provider/model and Flapstack SHALL
request every provider-supported visible reasoning channel. When disabled, the
system SHALL disable provider reasoning where supported and otherwise suppress
reasoning display while reporting that internal reasoning could not be disabled.
Encrypted or provider-private reasoning SHALL remain opaque.

#### Scenario: Reasoning enabled

- **WHEN** a chat has Reasoning enabled and the user selects an effort level
- **THEN** Flapstack sends the closest supported reasoning depth
- **AND** requests the richest supported visible summaries, text, commentary,
  plans, tool activity, metadata, and token counts

#### Scenario: Reasoning disabled

- **WHEN** the user disables Reasoning for a chat
- **THEN** future runs in that chat request disabled or none reasoning where supported
- **AND** unsupported providers degrade honestly without exposing reasoning UI

#### Scenario: Provider keeps reasoning private

- **WHEN** a provider returns encrypted, signed, omitted, or token-only reasoning
- **THEN** Flapstack preserves required continuity metadata and accurate usage
- **AND** does not fabricate or reconstruct visible reasoning text

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
without auto-sending. One application-level recording session SHALL remain bound
to the project, chat, conversation, and pre-dictation draft where it started,
including while the user changes chats, projects, or operating-system applications.
Speech playback SHALL be requested manually from a message;
the composer SHALL NOT expose automatic or per-chat read-aloud controls.

#### Scenario: Dictate and review before sending

- **WHEN** the user holds the mic control and speaks
- **THEN** a recording indicator is shown
- **AND** on release the transcript appears in the input without being sent

#### Scenario: Continue recording away from the origin chat

- **WHEN** the user starts dictation and then changes applications, chats, or projects
- **THEN** capture and transcription continue
- **AND** transcript updates remain in the origin conversation draft
- **AND** typed text in the newly visible conversation remains independently owned

#### Scenario: Return to or stop background dictation

- **WHEN** the origin conversation is no longer visible during recording
- **THEN** Flapstack shows a compact recording capsule naming the origin project and chat
- **AND** the user can return to the origin or stop and finalize its draft

#### Scenario: Start dictation in another conversation

- **WHEN** the user starts dictation in a second conversation while another is recording
- **THEN** Flapstack stops and fully finalizes the first recording into its origin draft
- **AND** starts the new recording only after that handoff

#### Scenario: Send while origin dictation is active

- **WHEN** the user sends from the origin conversation during recording
- **THEN** Flapstack finalizes all remaining origin audio before sending
- **AND** sends the complete origin-owned draft

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

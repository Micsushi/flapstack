## ADDED Requirements

### Requirement: Provider-Visible Thinking Display

The system SHALL display reasoning/thinking only when a harness or provider
exposes visible reasoning text, summaries, or protocol thought chunks, and SHALL
preserve non-displayable reasoning metadata without presenting it as readable
thinking.

#### Scenario: Visible thinking deltas are exposed

- **WHEN** a running harness emits visible thinking deltas, reasoning text,
  reasoning summaries, or protocol thought chunks
- **THEN** the system normalizes each delta into the shared thinking message part
- **AND** the chat updates the Thinking panel incrementally as the deltas arrive
- **AND** the system does not wait for the final assistant message to show one
  large thinking block

#### Scenario: Only final visible thinking is exposed

- **WHEN** a provider exposes visible thinking only after the turn finishes
- **THEN** the system renders that final visible thinking in the Thinking panel
- **AND** the system labels it honestly as final or summary-style reasoning when
  applicable

#### Scenario: Only opaque or counted reasoning is exposed

- **WHEN** a provider reports encrypted reasoning content, private reasoning state,
  or reasoning token counts without visible reasoning text
- **THEN** the system preserves the opaque metadata or token counts for continuity,
  debugging, or usage display
- **AND** the chat does not display fabricated chain-of-thought

#### Scenario: Saved history contains thinking

- **WHEN** saved CLI JSONL or session files contain historical thinking data
- **THEN** the system MAY use them for import, backfill, or debugging
- **AND** live runs still prefer streamed events from the owned harness process
- **AND** Stage 2 does not require a primary user-facing saved-history viewer

### Requirement: Provider Thinking Shapes

The system SHALL normalize each supported provider's visible thinking shape into
the same stream contract while preserving provider-specific limitations.

#### Scenario: Claude exposes thinking_delta events

- **WHEN** Claude emits `thinking_delta` events during a streamed run
- **THEN** each delta is appended to the Thinking panel as it arrives
- **AND** a later final `thinking` block does not duplicate already streamed text

#### Scenario: Codex or ACP exposes thought chunks

- **WHEN** Codex or an ACP-compatible path emits `Thought` or
  `AgentThoughtChunk` events
- **THEN** those chunks render in the shared Thinking panel

#### Scenario: OpenAI exposes only reasoning summaries or token counts

- **WHEN** OpenAI/Codex exposes a reasoning summary, encrypted reasoning payload,
  or reasoning token count
- **THEN** summaries render as visible reasoning summaries
- **AND** encrypted payloads remain opaque
- **AND** token counts are shown as usage/count metadata, with live display only
  when it is cheap to derive from existing provider usage data

#### Scenario: Cursor emits thinking events

- **WHEN** `cursor-agent` emits `type:"thinking"` delta or completed events
- **THEN** the adapter streams those deltas into the shared Thinking panel
- **AND** a Cursor run without those events still renders normally

#### Scenario: OpenRouter adapters expose reasoning fields

- **WHEN** OpenRouter emits visible `reasoning`, `reasoning_details`
  text/summary, or reasoning usage counts
- **THEN** those visible fields stream through the shared Thinking panel
- **AND** encrypted/provider-private details remain opaque metadata
- **AND** Stage 2 uses provider/model default reasoning request parameters unless
  capability metadata proves a request field is supported

#### Scenario: NanoGPT adapters expose reasoning fields

- **WHEN** NanoGPT emits visible `delta.reasoning`,
  `delta.reasoning_content`, final `message.reasoning`, or final
  `message.reasoning_content`
- **THEN** those visible fields stream through the shared Thinking panel
- **AND** absent reasoning fields are treated as no visible thinking, not an
  adapter failure
- **AND** Stage 2 uses provider/model default reasoning request parameters unless
  capability metadata proves a request field is supported

#### Scenario: Local adapters expose reasoning fields

- **WHEN** a local-model adapter emits AI SDK/opencode-style `reasoning` parts
- **THEN** those visible fields stream through the shared Thinking panel
- **AND** model-private internal state remains undisplayed

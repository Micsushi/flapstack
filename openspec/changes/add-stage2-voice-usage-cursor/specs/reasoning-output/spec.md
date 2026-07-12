## ADDED Requirements

### Requirement: Provider-Visible Reasoning Output

The system SHALL display reasoning output only when a harness or provider
exposes visible reasoning text, summaries, or protocol thought chunks, and SHALL
preserve non-displayable reasoning metadata without presenting it as readable
reasoning output.

#### Scenario: Visible reasoning-output deltas are exposed

- **WHEN** a running harness emits visible reasoning output deltas, reasoning text,
  reasoning summaries, or protocol thought chunks
- **THEN** the system normalizes each delta into the shared reasoning-output message part
- **AND** the chat updates the Reasoning output panel incrementally as the deltas arrive
- **AND** the system does not wait for the final assistant message to show one
  large reasoning-output block

#### Scenario: Reasoning progress and completed disclosure

- **WHEN** a running turn exposes visible reasoning output
- **THEN** the Reasoning output panel shows a live `Working for <duration>` timer
- **AND** the visible reasoning content remains available while the turn runs
- **WHEN** the turn finishes
- **THEN** the panel collapses to `Worked for <duration>` when duration metadata is available
- **AND** activating the completed row toggles the exact provider-visible reasoning content
- **AND** opaque, encrypted, or provider-private reasoning remains undisplayed

#### Scenario: Only final visible reasoning output is exposed

- **WHEN** a provider exposes visible reasoning output only after the turn finishes
- **THEN** the system renders that final visible reasoning output in the Reasoning output panel
- **AND** the system labels it honestly as final or summary-style reasoning when
  applicable

#### Scenario: Only opaque or counted reasoning is exposed

- **WHEN** a provider reports encrypted reasoning content, private reasoning state,
  or reasoning token counts without visible reasoning text
- **THEN** the system preserves the opaque metadata or token counts for continuity,
  debugging, or usage display
- **AND** the chat does not display fabricated chain-of-thought

#### Scenario: Saved history contains reasoning output

- **WHEN** saved CLI JSONL or session files contain historical reasoning-output data
- **THEN** the system MAY use them for import, backfill, or debugging
- **AND** live runs still prefer streamed events from the owned harness process
- **AND** Stage 2 does not require a primary user-facing saved-history viewer

### Requirement: Provider Reasoning-Output Shapes

The system SHALL normalize each supported provider's visible reasoning output shape into
the same stream contract while preserving provider-specific limitations.

#### Scenario: Claude exposes reasoning-output events

- **WHEN** Claude emits `thinking_delta` events during a streamed run
- **THEN** each delta is appended to the Reasoning output panel as it arrives
- **AND** a later final `thinking` block does not duplicate already streamed text

#### Scenario: Codex or ACP exposes thought chunks

- **WHEN** Codex or an ACP-compatible path emits `Thought` or
  `AgentThoughtChunk` events
- **THEN** those chunks render in the shared Reasoning output panel

#### Scenario: OpenAI exposes only reasoning summaries or token counts

- **WHEN** OpenAI/Codex exposes a reasoning summary, encrypted reasoning payload,
  or reasoning token count
- **THEN** summaries render as visible reasoning summaries
- **AND** encrypted payloads remain opaque
- **AND** token counts are shown as usage/count metadata, with live display only
  when it is cheap to derive from existing provider usage data

#### Scenario: Cursor emits reasoning-output events

- **WHEN** `cursor-agent` emits `type:"thinking"` delta or completed events
- **THEN** the adapter streams those deltas into the shared Reasoning output panel
- **AND** a Cursor run without those events still renders normally

#### Scenario: OpenRouter adapters expose reasoning fields

- **WHEN** OpenRouter emits visible `reasoning`, `reasoning_details`
  text/summary, or reasoning usage counts
- **THEN** those visible fields stream through the shared Reasoning output panel
- **AND** encrypted/provider-private details remain opaque metadata
- **AND** Stage 2 uses provider/model default reasoning request parameters unless
  capability metadata proves a request field is supported

#### Scenario: NanoGPT adapters expose reasoning fields

- **WHEN** NanoGPT emits visible `delta.reasoning`,
  `delta.reasoning_content`, final `message.reasoning`, or final
  `message.reasoning_content`
- **THEN** those visible fields stream through the shared Reasoning output panel
- **AND** absent reasoning fields are treated as no visible reasoning output, not an
  adapter failure
- **AND** Stage 2 uses provider/model default reasoning request parameters unless
  capability metadata proves a request field is supported

#### Scenario: Local adapters expose reasoning fields

- **WHEN** a local-model adapter emits AI SDK/opencode-style `reasoning` parts
- **THEN** those visible fields stream through the shared Reasoning output panel
- **AND** model-private internal state remains undisplayed

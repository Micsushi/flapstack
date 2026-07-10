## ADDED Requirements

### Requirement: OpenCode-Backed API Harness Runs

The system SHALL run OpenRouter and NanoGPT as first-class Flapstack harnesses
through a Flapstack-managed local OpenCode sidecar, persisting run records,
before/after checkpoints, file-change manifests, model identity, usage metadata,
provider raw payloads, sidecar metadata, and permission-gated tool activity.

#### Scenario: OpenRouter run in a chat

- **WHEN** the user selects the OpenRouter harness and sends a prompt in a chat
  with a configured OpenRouter key
- **THEN** the system launches or reuses a Flapstack-managed OpenCode sidecar
  configured for OpenRouter
- **AND** streams the response through the OpenCode session/event API
- **AND** the assistant message, run record, usage metadata, checkpoints, and
  file-change manifest are persisted with harness `openrouter`

#### Scenario: NanoGPT run in a chat

- **WHEN** the user selects the NanoGPT harness and sends a prompt in a chat with
  a configured NanoGPT key
- **THEN** the system launches or reuses a Flapstack-managed OpenCode sidecar
  configured for NanoGPT through OpenCode's OpenAI-compatible provider support
- **AND** streams the response through the OpenCode session/event API
- **AND** the assistant message, run record, usage metadata, checkpoints, and
  file-change manifest are persisted with harness `nanogpt`

#### Scenario: Provider key missing

- **WHEN** the selected OpenCode-backed provider harness has no configured key
- **THEN** the system reports an actionable not-configured state
- **AND** does not start a run or fabricate output

#### Scenario: OpenCode sidecar unavailable

- **WHEN** OpenCode cannot be resolved, launched, authenticated, or reached before
  the startup timeout
- **THEN** the system reports an actionable sidecar-unavailable state
- **AND** records the failure on the run without sending a provider request

### Requirement: Direct API Harness Identity

The system SHALL expose OpenRouter and NanoGPT in the harness/model selectors and
message producer chips with distinct provider identities. Cursor, OpenRouter, and
NanoGPT chip colors SHALL not conflict with existing Codex, Claude, local, or
unknown/custom chip colors.

#### Scenario: Direct API identity is visible

- **WHEN** an OpenRouter or NanoGPT run produces an assistant message
- **THEN** the chat tab and message show the correct provider chip
- **AND** the model selector shows the provider model id used for the run

### Requirement: Direct API Model Catalogs

The system SHALL fetch, cache, refresh, and search OpenRouter and NanoGPT model
catalogs, preserving provider model ids, context limits, pricing metadata when
available, and reasoning/tool capability hints when exposed.

#### Scenario: Model catalog refresh succeeds

- **WHEN** the user refreshes OpenRouter or NanoGPT models
- **THEN** the latest provider model list is cached locally
- **AND** model selection uses provider-native model ids without rewriting them

#### Scenario: Model catalog refresh fails

- **WHEN** the model catalog request fails
- **THEN** the system keeps the last successful cache if present
- **AND** reports the refresh failure without blocking already configured models

### Requirement: Direct API Tool Loop

The system SHALL mediate OpenRouter and NanoGPT local computer access through
OpenCode's tool loop plus Flapstack's permission mapping and approval bridge, so
the user-facing access categories match Codex and Claude where OpenCode can
enforce them.

#### Scenario: Tool call allowed by permission mode

- **WHEN** an OpenRouter or NanoGPT run requests file, shell, git, browser, or
  MCP tool use that is allowed by the resolved permission mode
- **THEN** OpenCode executes the tool locally under the Flapstack-generated
  permission rules
- **AND** Flapstack streams the OpenCode tool result back into the run transcript
- **AND** records the tool call, result, and permission decision on the run

#### Scenario: Tool call blocked by permission mode

- **WHEN** an OpenRouter or NanoGPT run requests file, shell, git, browser, or
  MCP tool use that is not allowed by the resolved permission mode
- **THEN** Flapstack blocks, asks for approval, or replies to OpenCode's approval
  request according to that mode
- **AND** the provider receives an honest denied, corrected, or approved
  observation through OpenCode
- **AND** the run metadata records the blocked capability

#### Scenario: Permission cannot be mapped exactly

- **WHEN** a Flapstack permission toggle cannot be represented exactly in
  OpenCode permission rules
- **THEN** the system reports a `HarnessPermissionLimitation`
- **AND** does not claim that the requested control was fully enforced

### Requirement: Direct API Reasoning Streams

The system SHALL normalize provider-visible OpenRouter and NanoGPT reasoning
fields surfaced through OpenCode events into the shared Thinking UI while keeping
provider-private or absent reasoning undisplayed.

The system SHALL use provider/model default reasoning request parameters in
Stage 2 unless model capability metadata proves an explicit reasoning field is
supported.

#### Scenario: OpenRouter emits reasoning

- **WHEN** OpenRouter streaming or final response data includes visible
  `reasoning` or `reasoning_details` text/summary
- **THEN** those fields render through the shared Thinking panel
- **AND** encrypted or provider-private reasoning details are stored only as
  opaque metadata when needed
- **AND** unsupported reasoning request fields are not sent

#### Scenario: NanoGPT emits reasoning

- **WHEN** NanoGPT streaming or final response data includes visible `reasoning`
  or legacy `reasoning_content`
- **THEN** those fields render through the shared Thinking panel
- **AND** a response without those fields still renders normally
- **AND** unsupported reasoning request fields are not sent

# reasoning-parity-evidence Specification

## Purpose

TBD - created by archiving change prove-reasoning-parity. Update Purpose after archive.

## Requirements

### Requirement: Honest Reasoning Classification

The system MUST classify provider reasoning as visible text, visible summary,
token-only, opaque/private, absent, or unsupported before rendering it.

#### Scenario: Provider emits visible reasoning

- **WHEN** a provider emits visible deltas, final text, a summary, or protocol
  thought chunks
- **THEN** the content is normalized into displayable reasoning parts
- **AND** provider identity, part identity, phase, and visibility class persist

#### Scenario: Provider emits only counts or private data

- **WHEN** a provider exposes reasoning token counts, encrypted details, or
  provider-private state without readable text
- **THEN** sanitized counts or opaque metadata may persist for continuity,
  usage, or diagnosis
- **AND** no readable reasoning panel or fabricated chain-of-thought is created

#### Scenario: Provider exposes no reasoning

- **WHEN** a successful turn has no visible reasoning field or event
- **THEN** assistant text still completes normally
- **AND** absence is not reported as an adapter failure or fake completed
  reasoning row

### Requirement: Stable Reasoning Stream and Persistence

The system MUST preserve one ordered visible reasoning sequence across stream,
final replay, tools, completion, remount, reload, and search.

#### Scenario: Deltas are followed by cumulative final content

- **WHEN** streamed deltas and a later final/cumulative event describe the same
  provider reasoning part
- **THEN** visible content grows in order without duplicate text
- **AND** an independent later reasoning part remains visible

#### Scenario: Turn completes and chat reloads

- **WHEN** a turn with visible reasoning completes and the chat remounts or the
  app restarts
- **THEN** the same visible content and duration metadata reload
- **AND** the collapsed completed row discloses the exact provider-visible text
- **AND** private tool input or opaque metadata remains excluded from search

#### Scenario: Reasoning interleaves with tools or plans

- **WHEN** provider-visible reasoning, plan, and tool lifecycle events interleave
- **THEN** each typed part retains its order and identity
- **AND** pending/running/completed tool updates do not duplicate reasoning or
  tool starts

### Requirement: Provider-Aware Reasoning Controls

The system MUST send reasoning on/off and effort controls only where current
provider/model capability supports them and MUST record the resolved request and
fallback honestly.

#### Scenario: Requested control is supported

- **WHEN** the selected provider/model supports the chosen reasoning toggle and
  effort level
- **THEN** the closest documented native request is sent
- **AND** the run records requested and resolved values

#### Scenario: Requested control is unsupported

- **WHEN** the selected provider/model does not support the requested field or
  depth
- **THEN** the field is omitted or conservatively mapped according to the
  provider contract
- **AND** UI/run metadata exposes the fallback or limitation
- **AND** the system does not claim exact control

### Requirement: Consistent Reasoning Disclosure

The system MUST present live and completed reasoning with provider-neutral,
accessible disclosure behavior while preserving honest provider distinctions.

#### Scenario: Visible reasoning streams

- **WHEN** visible reasoning arrives during a turn
- **THEN** one panel grows incrementally and shows an authoritative
  `Working for <duration>` state
- **AND** keyboard and assistive technology can reach and read the disclosure

#### Scenario: Turn completes

- **WHEN** the turn reaches a terminal state
- **THEN** the disclosure becomes `Worked for <duration>` when duration is known
- **AND** activating it toggles the persisted provider-visible content
- **AND** final-only summaries are identified honestly

### Requirement: Evidence-Graded Reasoning Parity

The system MUST complete a provider matrix that separates fixtures and captures
from real provider, UI, persistence, and fallback evidence.

#### Scenario: Live provider emits a different supported shape

- **WHEN** a current provider/model emits a supported shape different from the
  saved fixture
- **THEN** normalization remains truthful or the row fails with captured
  sanitized shape/version evidence
- **AND** fixture success cannot override the live failure

#### Scenario: Reasoning parity completes

- **WHEN** S3-F16 is marked complete
- **THEN** required Claude, Codex, Cursor, OpenRouter, and NanoGPT paths have
  exact provider-live, UI-live, persisted-reload, capability/fallback, and
  no-fabrication evidence
- **AND** focused tests, Node 22 `npm run check`, and strict OpenSpec pass
- **AND** unavailable conditional paths remain explicitly blocked

# provider-harness-closeout Specification

## Purpose

TBD - created by archiving change close-provider-harnesses. Update Purpose after archive.

## Requirements

### Requirement: Current Provider Capability Discovery

The system MUST validate current Cursor CLI, OpenCode sidecar, OpenRouter, and
NanoGPT capabilities before launching or advertising a harness behavior.

#### Scenario: CLI or provider surface changes

- **WHEN** version, help, status, model, health, or event output differs from a
  supported shape
- **THEN** the harness reports a typed unsupported, unknown, or error state
- **AND** headers, errors, or arbitrary text cannot become selectable model IDs

#### Scenario: Capability probe hangs

- **WHEN** a CLI, sidecar health call, session call, or response body never
  completes
- **THEN** a bounded timeout fails the operation
- **AND** child process, subscription, temporary config, and pending request are
  cleaned up

### Requirement: Cursor Harness Exit

The system MUST run Cursor as a first-class provider with honest auth, exact
model identity, streamed output, terminal state, persistence, cancellation,
continuation, and permission limitations.

#### Scenario: Authenticated Cursor turn succeeds

- **WHEN** an authenticated user sends a supported prompt with a valid Cursor
  model
- **THEN** assistant text and provider-visible reasoning stream when emitted
- **AND** run, session, checkpoints, manifest, provider, model, and terminal
  status persist
- **AND** Stop cancels and a later continuation resumes the correct session

#### Scenario: Cursor auth is missing then restored

- **WHEN** a prompt is blocked by missing Cursor auth and connection later
  succeeds
- **THEN** the blocked turn retries once through the same logical user message
- **AND** no duplicate user bubble or misleading successful run is created

#### Scenario: Cursor feature is unsupported

- **WHEN** images, a permission guarantee, or a reasoning control cannot be
  represented by the current Cursor CLI
- **THEN** the limitation is shown before launch where relevant
- **AND** unsupported input is rejected rather than silently dropped

### Requirement: OpenCode-Backed Provider Exit

The system MUST run OpenRouter and NanoGPT through isolated managed OpenCode
sessions with safe auth, bounded lifecycle, streamed output, tool decisions,
durable runs, usage, and exact provider/model identity.

#### Scenario: Provider turn succeeds

- **WHEN** a configured OpenRouter or NanoGPT user sends a supported prompt
- **THEN** the sidecar starts or is reused with isolated generated config
- **AND** subscription begins before asynchronous prompting
- **AND** text, visible reasoning, tools, decisions, usage, checkpoints,
  manifest, provider/model, and terminal state persist without secret leakage

#### Scenario: Provider approval is answered

- **WHEN** OpenCode requests a scoped tool approval
- **THEN** the user sees the exact bounded request and resolved permission mode
- **AND** allow-once, permitted reusable approval, or deny reaches the same
  provider loop exactly once
- **AND** the decision and limitation are durable and auditable

#### Scenario: Provider run fails or is cancelled

- **WHEN** prompt, stream, approval, persistence enrichment, or provider work
  fails or the user presses Stop
- **THEN** the run reaches the correct failed or cancelled terminal state
- **AND** sidecar requests/subscriptions are bounded and cleaned up
- **AND** optional usage failure cannot leave the chat or run stuck running

### Requirement: Chat-Capable Provider Defaults

The system MUST seed only currently listed, chat-capable provider models while
preserving user-added exact model IDs.

#### Scenario: NanoGPT default is stale or incompatible

- **WHEN** a seeded NanoGPT model is absent, disabled, or not compatible with
  the chat completion path
- **THEN** it is not offered as a working default
- **AND** a verified current chat-capable model becomes the seed only after a
  live minimal completion succeeds

#### Scenario: User adds a model

- **WHEN** a user selects a model from a refreshed provider catalog
- **THEN** its exact provider-native ID and capability metadata persist
- **AND** restart or cache refresh does not silently rewrite it to a display
  label or different default

### Requirement: Truthful Provider Harness Evidence

The system MUST keep fixture, CLI-live, provider-live, UI-live, and packaged
evidence distinct and complete all required exit rows on the exact Stage 3 SHA.

#### Scenario: Fixture passes without a live provider

- **WHEN** parsing or event fixtures pass but no authenticated provider turn was
  observed
- **THEN** the row is fixture-tested only
- **AND** provider-live or UI-live status remains open

#### Scenario: Provider harness closeout completes

- **WHEN** S3-F15 is marked complete
- **THEN** required Cursor, OpenRouter, and NanoGPT chat lifecycle rows pass in
  verified dev
- **AND** permission, auth recovery, model, persistence, cancellation, package,
  Node 22 full-gate, and strict OpenSpec evidence is attached
- **AND** unavailable credentials or platforms remain explicit blockers rather
  than inferred passes

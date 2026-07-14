# dev-test-control-mcp Specification

## Purpose

TBD - created by archiving change add-dev-test-control-mcp. Update Purpose after archive.

## Requirements

### Requirement: Development-only MCP lifecycle

Flapstack SHALL expose the test-control MCP only from a verified development
build, on loopback, with per-start authentication, and SHALL stop it with the
application.

#### Scenario: Packaged build

- **WHEN** Flapstack runs as Preview or production
- **THEN** the dev test-control MCP does not start or publish a descriptor

#### Scenario: Unauthorized local client

- **WHEN** a loopback client omits or supplies the wrong bearer token
- **THEN** the MCP request is rejected without invoking a tool

### Requirement: Exact and redacted inspection

The MCP SHALL provide bounded inspection of the active checkout, profile,
providers, chats, transcripts, runs, pending approvals, and relevant logs
without returning credentials or hidden reasoning metadata.

#### Scenario: Inspect a stalled run

- **WHEN** an authorized client requests a chat and its latest run
- **THEN** it receives stable identifiers, lifecycle timestamps, status,
  visible message text, tool activity, approval activity, and redacted errors

#### Scenario: Inspect a remounted reasoning timer

- **WHEN** an authorized client inspects a running or completed run timer
- **THEN** it receives the authoritative persisted start, elapsed or final
  duration, and the same status label derivation used by the renderer

### Requirement: Real provider test runs

The MCP SHALL launch supported provider tests through the same runtime and
persistence path used by Flapstack chat, and SHALL never fabricate completion.

#### Scenario: Launch OpenCode-backed provider

- **WHEN** an authorized client launches an OpenRouter or NanoGPT test prompt
- **THEN** Flapstack creates a real run, streams the provider, persists the
  assistant result, and returns a run identifier

#### Scenario: Unsupported harness

- **WHEN** a client requests a harness without a reusable dev launch service
- **THEN** the tool returns a structured unsupported result and changes nothing

### Requirement: Bounded run control

The MCP SHALL allow an authorized client to list and answer pending provider
approvals, cancel a matching active run, and wait with a bounded timeout.

#### Scenario: Child-agent approval

- **WHEN** a child provider session requests permission
- **THEN** the pending request is discoverable and one reply resumes the owning run

#### Scenario: Wait timeout

- **WHEN** a run does not reach a terminal state before the requested timeout
- **THEN** the wait returns the latest honest state without extending indefinitely

### Requirement: Reversible test-chat setup

The MCP SHALL register or restore the active development checkout as a test
project, create local provider test chats, select their canonical conversation,
and reversibly archive idle fixtures without deleting their history.

#### Scenario: Start from a clean isolated profile

- **WHEN** an authorized client requests a fixture and the profile has no project
- **THEN** the MCP registers only the active development checkout as a test project
- **AND** can select the created chat and canonical conversation without UI input

#### Scenario: Replace provider fixtures

- **WHEN** an authorized client archives an idle fixture and creates a replacement
- **THEN** the old chat remains recoverable and the new chat has exactly one
  canonical conversation using the requested provider, model, and project path

#### Scenario: Reflect an external MCP mutation

- **WHEN** the MCP creates or archives a test chat while the renderer is open
- **THEN** the live chat and archived-chat queries are invalidated and refetched

### Requirement: Provider-neutral question control

The MCP SHALL inspect, inject, answer, skip, and cancel bounded provider-neutral
question requests through the same lifecycle owner used by production adapters.

#### Scenario: Assert a live structured question without synthetic UI input

- **WHEN** an authorized client injects a question into an existing sub-chat
- **THEN** the lifecycle owner reports the pending request
- **AND** renderer test state reports whether the matching dialog is open
- **AND** an MCP answer, skip, or cancel produces one terminal resolution

### Requirement: Reversible orchestration control

The development MCP SHALL create a bounded read-only Codex or Claude fixture and
exercise orchestration through the same durable service used by the product,
without requiring UI input or a provider launch.

#### Scenario: Prepare an orchestration fixture

- **WHEN** an authenticated development client supplies an existing local project path
- **THEN** Flapstack creates or reuses that project and creates one read-only initiating
  chat with no credential, prompt, or provider result fabrication

#### Scenario: Control an orchestration without UI input

- **WHEN** an authenticated development client creates, reads, pauses, resumes, stops,
  retries, replaces, adds, reports progress, or archives an orchestration fixture
- **THEN** the action uses the production orchestration service and returns durable state
  suitable for functional assertions

### Requirement: Carryover surface control

The development MCP SHALL expose bounded functional reads and controls for Voice, Usage,
reasoning disclosure, and stored run review/undo without returning credentials, raw provider
payloads, transcript text from Voice History, or reasoning body text from the renderer.

#### Scenario: Inspect Voice and Usage without desktop input

- **WHEN** an authenticated development client inspects Voice or Usage
- **THEN** it receives production settings, readiness, counts, redacted provider state, and daemon
  health
- **AND** saved credentials are reported as presence booleans only

#### Scenario: Control a live disclosure without synthetic input

- **WHEN** an authenticated development client toggles a mounted reasoning or run-change
  disclosure or opens the stored Review surface
- **THEN** the production renderer action runs and returns bounded state attributes
- **AND** the response excludes reasoning body text and stored diff content

#### Scenario: Review or undo a stored run

- **WHEN** an authenticated development client requests a stored run review or conflict-safe undo
- **THEN** Flapstack uses the same checkpoint and inverse-merge services as the product UI
- **AND** overlapping later edits block the undo without partially changing files

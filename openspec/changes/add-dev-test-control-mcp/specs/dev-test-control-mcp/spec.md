## ADDED Requirements

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

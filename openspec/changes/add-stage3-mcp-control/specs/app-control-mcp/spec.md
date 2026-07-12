## ADDED Requirements

### Requirement: Local MCP exposure

Flapstack SHALL expose one local MCP control surface only to explicitly enabled
supported chats and SHALL stop it cleanly with the application.

#### Scenario: Disabled chat

- **WHEN** Flapstack MCP exposure is disabled for a chat
- **THEN** that chat cannot discover or call Flapstack app-control tools

#### Scenario: Enabled supported chat

- **WHEN** the user enables exposure for a supported chat
- **THEN** its harness can list and call tools through authenticated local transport

### Requirement: Structured operations

The server SHALL provide validated, stable operations for inspecting and
controlling supported Flapstack objects without returning raw database rows.

#### Scenario: Read app state

- **WHEN** an authorized caller lists projects, tasks, chats, runs, or worktrees
- **THEN** it receives compact identifiers, names, status, and scope breadcrumbs

#### Scenario: Invalid mutation input

- **WHEN** a caller submits malformed, stale, or out-of-scope input
- **THEN** the operation fails with a structured error and changes nothing

### Requirement: Permission and approval gate

Every MCP call MUST resolve trusted caller identity and pass the risk gate before
execution. Tier 3 operations MUST receive explicit user approval.

#### Scenario: Dangerous action

- **WHEN** any caller requests a Tier 3 action
- **THEN** Flapstack waits for explicit approval and denies on rejection or timeout

#### Scenario: Custom caller capabilities

- **WHEN** a caller uses custom permission mode
- **THEN** Flapstack loads its exact per-chat capability toggles from durable
  storage for every call and fails closed when that state is missing, malformed,
  stale, or unsupported

#### Scenario: Background approval

- **WHEN** a background chat needs approval
- **THEN** Flapstack signals the pending decision without stealing application focus

### Requirement: Auditable actions

Flapstack SHALL persist a redacted audit record for every allowed, denied,
approval-required, failed, and completed MCP call.

#### Scenario: Secret-bearing input

- **WHEN** an MCP input or result contains credential-like data
- **THEN** the audit record stores a redacted summary and no recoverable secret

### Requirement: Safe cross-agent spawning

Flapstack SHALL allow approved supported callers to create a thread for another
harness while preserving parent and initiator lineage.

#### Scenario: Claude spawns Codex

- **WHEN** a Claude caller receives approval to create and launch a Codex thread
- **THEN** Flapstack creates it with resolved scope, permissions, worktree, and lineage

#### Scenario: Recursive spawn attempt

- **WHEN** a spawn would violate self-reference or loop rules
- **THEN** Flapstack denies it and records the reason

### Requirement: User-visible management and safety

The user SHALL be able to inspect MCP exposure, connection state, pending
approvals, audit history, and actionable safety failures.

#### Scenario: Review audit history

- **WHEN** the user filters MCP history by caller, tool, or decision
- **THEN** matching redacted records are displayed without hidden execution

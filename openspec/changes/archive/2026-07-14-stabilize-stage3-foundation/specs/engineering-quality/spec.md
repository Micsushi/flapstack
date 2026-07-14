## ADDED Requirements

### Requirement: Strict repository baseline

The repository MUST pass strict TypeScript, lint, formatting, tests, and
production build through one supported commit gate before privileged Stage 3
app-control behavior is implemented.

#### Scenario: Stage 3 entry

- **WHEN** an agent begins Stage 3 MCP implementation
- **THEN** `npm run check` passes on supported Node 22 with zero TypeScript errors

#### Scenario: Blocking debt is discovered

- **WHEN** current evidence finds TypeScript, native ABI, schema, test, lint, or
  build debt that can make Stage 3 unsafe or unverifiable
- **THEN** the debt is fixed before S3-F2 begins

#### Scenario: Non-blocking debt is deferred

- **WHEN** evidence proves a debt item does not block safe Stage 3 work
- **THEN** its owner, reason, and later destination are recorded explicitly

### Requirement: Orderly application shutdown

The Electron main process MUST finish provider/session persistence and service
cleanup before it closes the application SQLite connection.

#### Scenario: First and duplicate quit requests

- **WHEN** Electron emits one or more quit requests while asynchronous cleanup
  is still pending
- **THEN** the first request is prevented, duplicate requests share one guarded
  shutdown promise, SQLite closes last, and the app exits without a quit loop

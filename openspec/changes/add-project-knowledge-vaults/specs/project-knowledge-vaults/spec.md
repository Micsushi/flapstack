## ADDED Requirements

### Requirement: Explicit vault location and tracking policy

Flapstack SHALL default a new project knowledge vault to app-managed central
storage and require explicit opt-in before using project-owned storage or git
tracking.

#### Scenario: Project accepts the default vault policy

- **WHEN** the user creates a vault without selecting an alternate location
- **THEN** Flapstack creates it in app-managed central storage with git tracking disabled

### Requirement: Typed durable knowledge sections

Flapstack SHALL manage stable typed sections for index, handoff, decisions,
context, task notes, and logs while keeping secrets outside the vault.

#### Scenario: Scaffold approved sections

- **WHEN** a user confirms vault setup and selected sections
- **THEN** Flapstack creates only those sections with stable metadata and a
  recoverable index

### Requirement: Explicit run context selection

Flapstack SHALL inject only user- or policy-selected sections into a run and
record the included source and size.

#### Scenario: Section is not selected

- **WHEN** a vault contains a decision log that is not selected for a run
- **THEN** the decision log is not added to that run's context

### Requirement: Safe concurrent editing

Flapstack SHALL detect concurrent changes and require reconciliation rather than
silently overwriting app or agent edits.

#### Scenario: File changes after editor load

- **WHEN** the app attempts to save against a stale content version
- **THEN** Flapstack shows the current diff and preserves both versions until the
  user chooses a resolution

### Requirement: Secrets exclusion

Flapstack SHALL reject or quarantine detected secrets and SHALL NOT inject them
into runs, previews, search snippets, logs, or audit summaries.

#### Scenario: Agent attempts a secret write

- **WHEN** an MCP write contains a detected credential or targets a secrets class
- **THEN** Flapstack denies or quarantines the content and records only a redacted event

### Requirement: Recoverable export and restore

Flapstack SHALL export and restore vault content with section metadata and schema
version while excluding secrets.

#### Scenario: Restore into an existing vault

- **WHEN** an import conflicts with current content
- **THEN** Flapstack previews the conflict and does not overwrite until confirmed

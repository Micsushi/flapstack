## ADDED Requirements

### Requirement: Versioned selective export bundle

Flapstack SHALL create a directory bundle with versioned manifest, consistent
database snapshot, selected file-backed scopes, checksums, and exclusion report.

#### Scenario: User exports selected project knowledge and workspaces

- **WHEN** those scopes and project are selected
- **THEN** the bundle contains only required selected/dependent data and records all exclusions

#### Scenario: User exports one project

- **WHEN** a project filter is selected
- **THEN** the bundle includes that parent project and its dependent rows through explicit per-table relationships
- **AND** source-machine paths are replaced by portable mapping markers or excluded with category-only evidence

### Requirement: Secrets excluded by default

Flapstack SHALL exclude credentials, tokens, session grants, webhook URLs, and
other detected secrets from every bundle and sync scope.

#### Scenario: Stored config references a credential

- **WHEN** export serializes that config
- **THEN** it preserves a non-secret reference or placeholder and reports the
  excluded credential category without revealing its value

### Requirement: Mandatory dry-run import

Flapstack SHALL verify, migrate, and diff an import in staging before changing live state.

#### Scenario: Bundle contains unsupported future schema

- **WHEN** dry-run detects a version newer than supported
- **THEN** import stops before live mutation and reports the unsupported scope/version

### Requirement: Recoverable transactional apply

Flapstack SHALL create a pre-import backup, apply database and file changes
atomically by scope, journal progress, and roll back after failure or interruption.

#### Scenario: App exits during file swap

- **WHEN** Flapstack restarts with an incomplete import journal
- **THEN** it restores the previous valid state or completes the verified swap
  without publishing mixed versions

#### Scenario: Database work is active when apply starts

- **WHEN** a previously admitted request, scheduler, daemon, or MCP operation still uses the active database
- **THEN** maintenance blocks new operations, drains the admitted work, and closes the singleton only after release

#### Scenario: A recorded backup is replaced before recovery

- **WHEN** a database or file backup no longer matches its journaled regular-file identity and content hash
- **THEN** recovery rejects it before the unreviewed bytes can replace live state

### Requirement: Explicit conflict policy

Flapstack SHALL preview create/update/conflict/skip decisions and SHALL NOT
delete unselected live data implicitly.

#### Scenario: Imported vault file conflicts with local edits

- **WHEN** both versions changed from the known base
- **THEN** the import pauses that item and preserves both versions for resolution

#### Scenario: User preserves both conflict values

- **WHEN** keep-both is confirmed for a database row or file
- **THEN** the local value remains live and both actual versions are materialized in a deterministic operation artifact

### Requirement: Reviewed target mappings and relational integrity

Flapstack SHALL require reviewed destination mappings for machine-local project,
extension, and vault roots, apply records in declared dependency order, enforce
foreign keys, and roll back any invalid reference.

#### Scenario: Clean profile imports project and vault data

- **WHEN** the destination has no matching local roots
- **THEN** dry-run requires explicit safe mappings and confirmed apply creates only eligible missing file roots

### Requirement: User-owned private git sync

Flapstack SHALL sync only approved file-backed safe scopes with a user-owned git
repository and SHALL preview pull/commit/push impact before mutation.

#### Scenario: Remote change conflicts locally

- **WHEN** pull cannot fast-forward or cleanly merge an approved scope
- **THEN** Flapstack stops, shows the conflict, and does not overwrite or force-push

#### Scenario: Git range crosses an unapproved path or secret blob

- **WHEN** an incoming or outgoing commit range touches an unapproved path or contains a secret blob
- **THEN** preview rejects the operation before pull or push

#### Scenario: Remote moves after preview

- **WHEN** the remote branch changes after preview
- **THEN** pull fast-forwards only to the already reviewed fetched OID and push refuses the stale remote OID

#### Scenario: Private history exceeds review limits

- **WHEN** the reviewed commit, changed-path, Git-output, or scanned-blob budget is exceeded
- **THEN** preview and confirmation fail closed with the same split-or-squash limitation

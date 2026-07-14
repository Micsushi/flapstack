## ADDED Requirements

### Requirement: Versioned selective export bundle

Flapstack SHALL create a directory bundle with versioned manifest, consistent
database snapshot, selected file-backed scopes, checksums, and exclusion report.

#### Scenario: User exports selected project knowledge and workspaces

- **WHEN** those scopes and project are selected
- **THEN** the bundle contains only required selected/dependent data and records all exclusions

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

### Requirement: Explicit conflict policy

Flapstack SHALL preview create/update/conflict/skip decisions and SHALL NOT
delete unselected live data implicitly.

#### Scenario: Imported vault file conflicts with local edits

- **WHEN** both versions changed from the known base
- **THEN** the import pauses that item and preserves both versions for resolution

### Requirement: User-owned private git sync

Flapstack SHALL sync only approved file-backed safe scopes with a user-owned git
repository and SHALL preview pull/commit/push impact before mutation.

#### Scenario: Remote change conflicts locally

- **WHEN** pull cannot fast-forward or cleanly merge an approved scope
- **THEN** Flapstack stops, shows the conflict, and does not overwrite or force-push

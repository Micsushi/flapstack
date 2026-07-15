## ADDED Requirements

### Requirement: Visible bounded visual capture

Flapstack SHALL capture only user-selected supported visual sources after visible
initiation or explicit scoped approval.

#### Scenario: Agent requests a screen region

- **WHEN** no active capture approval exists
- **THEN** Flapstack waits for user source selection and confirmation

### Requirement: Preview and redaction before use

Flapstack SHALL preview captured content and allow crop/annotation/redaction
before it enters chat, artifacts, knowledge, export, or agent context.

#### Scenario: User redacts a token

- **WHEN** the capture is confirmed
- **THEN** downstream consumers receive the redacted derivative, not hidden pixels

### Requirement: Provenance-rich visual artifacts

Flapstack SHALL store capture identity, scope, hash, actor, timestamp, dimensions,
redaction state, and ownership without inventing missing legacy provenance.

#### Scenario: Screenshot is attached to a run

- **WHEN** the run starts
- **THEN** its immutable context record names the exact confirmed artifact hash

### Requirement: Safe lifecycle and portability

Flapstack SHALL apply retention, deletion, export, path safety, and platform
permission rules to visual artifacts and standalone helper use.

#### Scenario: Source permission is revoked

- **WHEN** another capture is requested
- **THEN** capture fails with OS-specific recovery and no stale frame is reused

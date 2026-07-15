## ADDED Requirements

### Requirement: Default-off private mobile bridge

Flapstack SHALL keep the mobile bridge disabled by default and bind only approved
private interfaces over authenticated HTTPS.

#### Scenario: Host moves to an unapproved network

- **WHEN** network identity changes to a public or unapproved interface
- **THEN** the bridge closes and requires explicit re-enable/rebind

### Requirement: One-time pairing and revocable device identity

Flapstack SHALL pair through a short-lived single-use token, verified certificate
fingerprint, and per-device public-key credential with immediate revocation.

#### Scenario: Pairing token is reused

- **WHEN** a consumed or expired token is submitted
- **THEN** no device/session is created and the attempt is audited

### Requirement: Sequenced authorized mobile state

Flapstack SHALL project only granted project/task/chat/run/orchestration/
automation/approval/artifact state through snapshots and monotonic events.

#### Scenario: Client reconnects with an event gap

- **WHEN** the resume cursor is incomplete
- **THEN** incremental state is discarded and a fresh snapshot is required

### Requirement: Bounded shared-service control

Flapstack SHALL expose only typed clarification, steering, pause, resume, cancel,
and capability-listed actions through existing production services.

#### Scenario: Mobile requests an arbitrary command

- **WHEN** action is outside the catalog
- **THEN** it is rejected before dispatch with a redacted audit denial

### Requirement: Honest mobile approval and notification behavior

Flapstack SHALL require exact risk/context review, stronger verification where
required, and SHALL label offline data and notifications honestly.

#### Scenario: Phone is offline

- **WHEN** bridge connectivity is lost
- **THEN** cached data becomes timestamped read-only and mutations are disabled

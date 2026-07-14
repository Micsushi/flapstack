## ADDED Requirements

### Requirement: Default-off private mobile bridge

Flapstack SHALL keep the mobile bridge disabled by default and SHALL bind only
explicitly approved private interfaces over authenticated HTTPS.

#### Scenario: Host network changes to public

- **WHEN** an enabled bridge detects an unapproved/public interface transition
- **THEN** Flapstack closes the listener and requires explicit re-enable/rebind

### Requirement: One-time pairing and revocable device identity

Flapstack SHALL pair through a short-lived single-use token, verified certificate
fingerprint, and per-device public-key credential with immediate revocation.

#### Scenario: Pairing QR is reused

- **WHEN** a consumed or expired token is submitted again
- **THEN** Flapstack rejects it and creates no device/session

### Requirement: Sequenced mobile read model

Flapstack SHALL project authorized project/task/chat/run/orchestration/automation,
approval, diff, artifact, and test state through snapshots and monotonic events.

#### Scenario: Client misses an event sequence

- **WHEN** reconnect observes a gap
- **THEN** the client discards unsafe incremental state and requests a fresh snapshot

### Requirement: Bounded mobile steering and control

Flapstack SHALL expose only typed clarification, steering, pause, resume, cancel,
and capability-listed control operations with stale-state preconditions.

#### Scenario: Mobile requests an arbitrary shell command

- **WHEN** the request is outside the mobile action catalog
- **THEN** Flapstack rejects it before dispatch and records a redacted denial

### Requirement: Mobile approval safety

Flapstack SHALL show caller, project, task, worktree, action, inputs, risk, and
expiry before approval and SHALL require stronger device verification for high risk.

#### Scenario: Device lacks strong verification

- **WHEN** a high-risk action requires passkey/WebAuthn and the device cannot provide it
- **THEN** mobile cannot approve and the request remains available for desktop decision

### Requirement: Honest offline and notification behavior

Flapstack SHALL mark disconnected data stale/read-only and SHALL describe mobile
notifications as best effort without a hosted relay.

#### Scenario: Phone loses bridge connectivity

- **WHEN** the client is offline
- **THEN** cached state shows last-updated time, mutations are disabled, and reconnect resnapshots

### Requirement: Audited device and action lifecycle

Flapstack SHALL audit pairing, session, revocation, reads of sensitive summaries,
and every attempted mobile mutation without storing secrets or hidden reasoning.

#### Scenario: Device is revoked during an active session

- **WHEN** desktop revokes the device
- **THEN** active connections close and subsequent requests fail immediately

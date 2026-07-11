## ADDED Requirements

### Requirement: External MCP process boundary

Flapstack SHALL integrate with Flapshot only as a separately configured external stdio
MCP server and SHALL NOT copy, link, package, or share its runtime or database.

#### Scenario: Flapshot is not configured

- **WHEN** no stdio MCP server named `flapshot` is configured
- **THEN** capture actions are unavailable with setup guidance
- **AND** Flapstack does not launch or package a fallback runtime

#### Scenario: HTTP server is configured

- **WHEN** the configured `flapshot` server uses HTTP
- **THEN** the direct capture client rejects it as the wrong transport

### Requirement: Capability-gated capture actions

Flapstack SHALL expose only capture actions supported by the negotiated server tools and
application capability snapshot.

#### Scenario: Capability is unavailable

- **WHEN** a capture method is missing, degraded as unavailable, or reports a denial reason
- **THEN** its action is disabled or hidden with the public reason

#### Scenario: Schema is incompatible

- **WHEN** a required application schema version is unsupported
- **THEN** Flapstack rejects the connection without invoking capture

#### Scenario: Recording target is discovered

- **WHEN** recording start is available and a bounded public display target is returned
- **THEN** Flapstack starts recording with that exact source and display ID
- **AND** never derives a private native source ID

### Requirement: Explicit live pairing

Flapstack SHALL treat each Flapshot stdio process as a new zero-authority connection,
discover dedicated transport authentication from MCP `tools/list`, and enable capture
only after that exact live status reports it paired.

#### Scenario: Transport authentication tool is absent

- **WHEN** `tools/list` does not advertise the dedicated authentication tool
- **THEN** pairing remains unknown and capture controls stay unusable
- **AND** Flapstack does not call a private Flapshot transport API

#### Scenario: Connection is unpaired

- **WHEN** Flapshot reports a six-digit pairing code
- **THEN** Flapstack displays that code with Agent access guidance
- **AND** screenshot and recording actions stay disabled

#### Scenario: Connection is paired

- **WHEN** the user pairs the exact live connection in Flapshot
- **THEN** Flapstack refreshes authentication status and enables capability-supported actions

#### Scenario: Connection restarts

- **WHEN** the MCP process disconnects or restarts
- **THEN** prior pairing is not reused
- **AND** Flapstack displays the new live pairing state

### Requirement: Honest operation lifecycle

Flapstack SHALL persist and display public operation progress, cancellation, correlation,
audit correlation, disconnect, restart, timeout, denial, and terminal errors.

#### Scenario: Transport disconnects

- **WHEN** stdio disconnects during a nonterminal operation
- **THEN** Flapstack marks the local operation interrupted
- **AND** does not create an attachment from transport success alone

#### Scenario: Client reconnects

- **WHEN** the user reconnects after disconnect or app restart
- **THEN** Flapstack queries the public operation state and reconciles known operations
- **AND** missing upstream state remains an explicit interruption

#### Scenario: Shared project connection has operations from multiple chats

- **WHEN** polling or restart is triggered by one chat
- **THEN** each stored operation rebuilds scope from its own chat and task
- **AND** a result can attach only to its accepted chat owner

#### Scenario: Operation response identity differs

- **WHEN** operation, request, client, session, or response metadata differs from the
  accepted stored owner
- **THEN** Flapstack rejects the refresh before update or attachment ingestion

#### Scenario: Confirm profile requires approval

- **WHEN** a capture call returns `APPROVAL_REQUIRED`
- **THEN** Flapstack directs the user to approve in Flapshot and retry on the same connection
- **AND** does not claim the operation started before acceptance

### Requirement: Integrity-checked media ingestion

Flapstack SHALL accept only bounded image/video results or validated local references whose
artifact identity, resource URI, canonical path, MIME signature, size, SHA-256, and
provenance are valid.

#### Scenario: Managed screenshot succeeds

- **WHEN** a screenshot operation succeeds with a managed artifact reference
- **THEN** Flapstack cross-checks the authorized resource reference against the operation
- **AND** stores the attachment only after file and provenance validation

#### Scenario: Large recording succeeds

- **WHEN** a valid recording exceeds the bounded copy threshold but not the video limit
- **THEN** Flapstack stores a validated file-backed attachment reference
- **AND** does not inline or duplicate the video

#### Scenario: File is missing or tampered

- **WHEN** a stored/reference file disappears or its path, MIME, size, or SHA-256 changes
- **THEN** Flapstack reports `missing` or `tampered`
- **AND** does not present the attachment as verified

#### Scenario: Validated reference is used later

- **WHEN** Flapstack reads or copies a Flapshot attachment after ingestion
- **THEN** it revalidates grant expiry, path, MIME, size, and SHA-256 immediately before use
- **AND** verifies copied bytes before atomic publication

## ADDED Requirements

### Requirement: Versioned execution-host authority

Flapstack SHALL bind workspace operations to an authenticated execution host and
SHALL negotiate capabilities and protocol compatibility before use.

#### Scenario: Client and host are incompatible

- **WHEN** either side requires a newer incompatible protocol version
- **THEN** Flapstack blocks affected operations and shows the exact side to update

### Requirement: Truthful remote process and terminal state

Flapstack SHALL distinguish live, exited, unverifiable, and unreachable remote
state and SHALL reattach only to verified owned processes.

#### Scenario: SSH connection drops

- **WHEN** transport disconnects without verified process exit
- **THEN** sessions become unreachable or unverifiable rather than exited and
  reconnect attempts preserve their identities

### Requirement: Scoped SSH workspaces and ports

Flapstack SHALL route remote files, Git, worktrees, terminals, and explicit port
forwards through the selected SSH host with revocation and audit.

#### Scenario: Port forward is revoked

- **WHEN** a user closes or revokes a forward
- **THEN** both endpoints close, the inventory updates, and reconnect does not
  recreate it without an enabled durable rule

### Requirement: Native mobile client on existing security contracts

Flapstack SHALL provide an iOS/Android client that uses existing pairing, device
identity, grants, revocation, step-up, replay defense, and stale read-only rules.

#### Scenario: Mobile device is revoked

- **WHEN** desktop revokes a paired native device
- **THEN** live sessions close, cached data becomes inaccessible, and reconnect
  cannot restore authority without new pairing

### Requirement: Mobile development workspace controls

Flapstack SHALL expose only granted Chat, terminal, file, diff, source-control,
browser, task, account, usage, and approval actions through existing services.

#### Scenario: Mobile tries to overwrite an externally changed file

- **WHEN** the file identity differs from the mobile editor base
- **THEN** the write fails with a conflict and preserves both disk content and draft

### Requirement: Native mobile voice and diagnostics

Flapstack SHALL provide origin-safe mobile dictation, grant-checked notification
actions, accessible core controls, and a redacted connection report.

#### Scenario: Mobile diagnostic report is exported

- **WHEN** a user previews and exports connection evidence
- **THEN** prompts, file contents, credentials, private paths, and unsupported
  fields are absent or irreversibly redacted

### Requirement: Development-only mobile emulator

Flapstack SHALL offer a desktop mobile-client emulator for development while
keeping emulator evidence distinct from real-device and release certification.

#### Scenario: Production package is built

- **WHEN** Flapstack creates a distributable desktop package
- **THEN** mock authority and development secrets are absent and emulator results
  are not reported as real-device evidence

### Requirement: WSL host and provider-account parity

Flapstack SHALL treat each supported WSL distribution as a distinct execution
target with distro-correct paths, provider homes, usage, and process ownership.

#### Scenario: Account is selected for one WSL distribution

- **WHEN** a managed provider account is active in one distro
- **THEN** launches and usage in another distro or the Windows host remain unchanged

### Requirement: Optional end-to-end encrypted relay routing

Flapstack SHALL support a replaceable relay transport with peer-bound encryption,
revocation, replay defense, bounded backpressure, and direct-route fallback.

#### Scenario: Relay route disconnects during a live remote process

- **WHEN** the relay connection drops without verified process exit
- **THEN** Flapstack preserves process/session identity, marks the route
  unreachable, and reconnects without duplicating mutations or terminal bytes

### Requirement: Privacy-preserving regional relay placement

Flapstack SHALL select only allowlisted broker-owned relay regions through
bounded latency probes and SHALL keep local/direct operation independent of the
broker.

#### Scenario: Region catalog cannot be trusted

- **WHEN** the catalog is invalid, unavailable, or contains an unapproved endpoint
- **THEN** Flapstack ignores it and uses a safe default assignment or direct route
  without sending credentials, pairing data, or content

### Requirement: Owned ephemeral VM runtimes

Flapstack SHALL provision ephemeral VM workspaces only from explicit pinned
recipes and SHALL preserve host identity, resource ownership, quotas, lifecycle
truth, and verified cleanup across create, connect, snapshot, resume, and delete.

#### Scenario: VM cleanup only partially succeeds

- **WHEN** one owned VM resource cannot be removed after identity revalidation
- **THEN** Flapstack keeps the runtime visible as cleanup-incomplete with the
  exact remaining resource and a safe retry path

## MODIFIED Requirements

### Requirement: Bounded shared-service control

Flapstack SHALL expose only capability-advertised, grant-scoped actions through
existing production services, including native mobile terminal, file, Git,
browser, task, and provider-account actions added by this change.

#### Scenario: Native mobile requests an ungranted terminal action

- **WHEN** a device lacks terminal authority for the target workspace
- **THEN** the request is rejected before dispatch and recorded as a redacted denial

## ADDED Requirements

### Requirement: Native forge and task workflows

Flapstack SHALL browse supported provider tasks and reviews and create local work
through existing project, worktree, permission, and audit authorities.

#### Scenario: Task creates a worktree

- **WHEN** a user selects a supported issue and confirms branch/worktree details
- **THEN** Flapstack creates exactly one owned worktree linked to the provider item
  without mutating unrelated branches

### Requirement: Capability-driven forge breadth

Flapstack SHALL support GitHub, GitLab, Linear, Jira, Azure DevOps, Bitbucket,
and Gitea through versioned provider capabilities and host-scoped credentials.

#### Scenario: Self-hosted provider lacks one review action

- **WHEN** a connected provider does not advertise that action
- **THEN** Flapstack omits the control and preserves all other supported reads
  and mutations without emulation

### Requirement: Complete hosted review lifecycle

Flapstack SHALL show and safely mutate review identity, checks, comments,
reviewers, conflict state, draft state, merge strategy, and auto-merge only when
supported by the selected provider.

#### Scenario: Review state changes after preview

- **WHEN** base/head identity, checks, conflicts, or merge eligibility changes
  before a confirmed mutation
- **THEN** Flapstack blocks the stale action and requires a refreshed preview

### Requirement: Managed embedded browser

Flapstack SHALL host browser tabs in isolated managed profiles with explicit
navigation, permission, download, certificate, and lifecycle controls.

#### Scenario: Saved browser pane opens

- **WHEN** a saved workspace restores a valid browser binding
- **THEN** it attaches to the managed browser surface instead of opening an
  unrestricted external URL automatically

### Requirement: Design Mode context capture

Flapstack SHALL let users select a visible browser element and attach bounded
DOM, style, geometry, URL, and screenshot evidence to an agent prompt.

#### Scenario: Selected element disappears

- **WHEN** the page changes before capture commits
- **THEN** Flapstack reports stale selection and captures no unrelated element

### Requirement: Isolated browser identity and network controls

Flapstack SHALL scope user-agent, proxy, cookies, storage, WebAuthn identity,
credential references, HTTP authentication, and downloads to one managed
browser profile with explicit disclosure and audit.

#### Scenario: Browser state is imported

- **WHEN** a user previews and confirms cookie or storage import into a managed
  profile
- **THEN** Flapstack reports the source and data classes, imports only the
  approved state, and exposes nothing to another profile

### Requirement: Thin local operator CLI

Flapstack SHALL expose authenticated CLI commands through the same services and
authority used by the desktop UI.

#### Scenario: No trusted desktop endpoint exists

- **WHEN** a state-changing CLI command cannot authenticate to Flapstack
- **THEN** it fails without opening the database or launching an alternate service

### Requirement: Complete operator and orchestration commands

Flapstack SHALL expose versioned structured commands for supported product
resources and orchestration workers while preserving production permissions,
audit, idempotency, cancellation, and dependency validation.

#### Scenario: Retried orchestration mutation has already settled

- **WHEN** a client retries the same idempotency identity after settlement
- **THEN** Flapstack returns the existing receipt without creating another task,
  message, filesystem change, or UI action

### Requirement: Version-matched bundled operator guidance

Flapstack SHALL ship discoverable operator, orchestration, browser, and Computer
Use skill guides whose commands and safety limits match the installed schemas.

#### Scenario: Bundled guide falls behind its command schema

- **WHEN** a governed CLI or permission contract changes without regenerating
  its bundled guide
- **THEN** verification fails before packaging rather than shipping stale agent
  instructions

### Requirement: Honest generic terminal agents

Flapstack SHALL launch configured terminal agents with declared capabilities and
SHALL NOT infer structured status, permission, usage, or resume support.

#### Scenario: Generic agent lacks a status hook

- **WHEN** only terminal process evidence is available
- **THEN** Flapstack shows terminal/process state and labels agent-specific state unavailable

### Requirement: Versioned CLI-agent preset and adapter catalog

Flapstack SHALL provide launch presets for every declared CLI agent and SHALL
activate provider-specific hooks, status, account, resume, approval, and usage
only for verified compatible versions.

#### Scenario: Agent-specific hook is incompatible

- **WHEN** an installed agent version does not match its structured adapter
- **THEN** Flapstack falls back to the labeled generic terminal runtime without
  falsifying status, account, resume, approval, or usage

### Requirement: Permission-gated Computer Use

Flapstack SHALL require visible target evidence, scoped permission, audit, and a
stop path before operating another application or browser surface.

#### Scenario: Target changed after preview

- **WHEN** current target evidence does not match the approved preview
- **THEN** Flapstack blocks the input action and requests a fresh preview

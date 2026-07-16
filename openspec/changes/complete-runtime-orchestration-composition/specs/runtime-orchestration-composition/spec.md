## ADDED Requirements

### Requirement: Native Runtime compatibility remains truthful

Flapstack SHALL resolve and snapshot an execution target whose harness, Runtime,
provider, model, account, Agent Profile, permission, and workspace/worktree are
compatible, and SHALL NOT silently substitute any target field.

#### Scenario: Codex target requests Claude Code Runtime

- **WHEN** a Codex target requests the Claude Code Runtime
- **THEN** Flapstack blocks before Chat/run mutation, explains the incompatible
  native protocol, and offers only reviewed compatible targets

#### Scenario: Automatic Runtime resolves for Claude Code

- **WHEN** a Claude Code target selects Automatic Runtime
- **THEN** Flapstack resolves only a Runtime compatible with the Claude harness,
  previews the exact target, and snapshots its capability and adapter versions

### Requirement: Cross-provider continuation creates a child Chat

Flapstack SHALL continue work across providers by creating a distinct child
Chat and native provider session with explicit lineage and bounded visible
history context while leaving the source Chat unchanged.

#### Scenario: Continue a Codex Chat with Claude Code

- **WHEN** the user approves `Continue with Claude Code`
- **THEN** Flapstack creates a child Claude Code Chat/session, imports only the
  previewed visible context, labels it as imported context, and preserves a
  navigable source-child lineage edge

#### Scenario: Source Chat is later deleted or archived

- **WHEN** the child Chat remains addressable
- **THEN** its immutable source IDs and context manifest remain, and unavailable
  navigation is marked stale without reparenting the child

### Requirement: Cross-provider delegation uses durable task and result envelopes

Flapstack SHALL delegate across providers through versioned bounded task and
result envelopes tied to a distinct child Chat/run and immutable execution
target.

#### Scenario: Claude delegates a review to Codex

- **WHEN** a Claude parent delegates a bounded review to a compatible Codex target
- **THEN** a Codex child Chat/run receives the approved task/context envelope
  and returns a durable result that references its summary, structured output,
  artifacts, changes, usage, limitations, and terminal evidence

#### Scenario: Delegated target cannot satisfy a required capability

- **WHEN** its live capability probe lacks a required task-envelope capability
- **THEN** delegation blocks before provider intent and no prompt imitation or
  alternate target is launched silently

### Requirement: Cross-provider context is bounded and private

Flapstack SHALL preview and audit the exact visible context, files, and artifacts
sent across a provider boundary and SHALL exclude secrets, private/encrypted
reasoning, provider session state, hidden tool state, and unselected content.

#### Scenario: Source activity contains private reasoning and a credential

- **WHEN** a cross-provider context manifest is built
- **THEN** neither item is exported, the manifest records the applicable
  omission classes, and the child receives no recoverable plaintext copy

#### Scenario: Imported history is rendered in the child Chat

- **WHEN** the child opens
- **THEN** imported content is identified as source context rather than native
  child-provider messages or reasoning

### Requirement: Single Runtime request authority

Flapstack SHALL route provider-native direct and coordination requests through
Agent Runtime and SHALL NOT let orchestration create a second provider
client/parser, session owner, or native activity stream.

#### Scenario: Workflow selects Codex V2 coordination

- **WHEN** the resolved Codex target supports the required protocol version
- **THEN** F11 sends the request through its App Server authority and F3 records
  only coordination policy, identity, references, and workflow state

### Requirement: Structured-output propagation

Flapstack SHALL forward required workflow output schemas through compatible
Runtime options and validate the final durable result before barrier completion.

#### Scenario: Adapter lacks required structured output

- **WHEN** a delegated step declares a required schema
- **THEN** launch blocks before worker claim and no fallback prompt is invented

#### Scenario: Child terminates without valid required output

- **WHEN** provider execution is terminal but output is absent or invalid
- **THEN** the child terminal evidence remains truthful and the workflow barrier
  fails without treating prose or a prior attempt as success

### Requirement: Delegated authority cannot expand

Flapstack SHALL compute child authority as the intersection of parent delegation
ceiling, Agent Profile, target capability, project policy, and approved
per-launch restrictions, and SHALL isolate provider credentials and grants.

#### Scenario: Child profile requests broader filesystem access

- **WHEN** the parent can delegate only project-scoped writes
- **THEN** the child cannot receive broader access and launch blocks or previews
  an explicitly narrowed effective permission

#### Scenario: Delegation changes provider account or worktree

- **WHEN** the resolved target crosses an unapproved account or workspace boundary
- **THEN** Flapstack invalidates the prior preview and requires the applicable
  approval before durable provider intent

### Requirement: Worktree composition is explicit and conflict safe

Flapstack SHALL snapshot the child's workspace/worktree and enforce durable
lease and conflict policy without performing implicit integration actions.

#### Scenario: Two providers request the same writable worktree

- **WHEN** concurrent ownership violates the selected worktree policy
- **THEN** the later delegation blocks or uses an approved isolation choice, and
  Flapstack does not auto-merge, commit, push, deploy, or delete work

### Requirement: Truthful cross-provider controls

Flapstack SHALL expose cancel, pause, resume, and steer only according to each
resolved target's capabilities and SHALL persist exact per-target results.

#### Scenario: Mixed group pause includes unsupported child

- **WHEN** group pause runs
- **THEN** supported targets pause and the unsupported child remains unchanged
  with a durable reason and audit entry

#### Scenario: Child becomes terminal while cancellation is sent

- **WHEN** terminal reconciliation wins the lifecycle compare-and-set
- **THEN** terminal state remains authoritative and no cancellation or retry
  replays the completed attempt

### Requirement: Nonduplicated activity, usage, and recovery

Flapstack SHALL preserve F11 activity and usage authority while adding F3
composition events by reference, and SHALL recover exact attempts without
replaying completed, separately claimed, or uncertain work.

#### Scenario: Parent aggregates mixed-provider usage

- **WHEN** Codex and Claude child runs complete in one workflow
- **THEN** the parent references each actual provider/account/model/Runtime usage
  record once and keeps unavailable usage unknown rather than inventing a value

#### Scenario: App restarts after child provider intent

- **WHEN** the child is terminal, active, or uncertain at restart
- **THEN** Flapstack reconciles that exact run/session, projects durable truth,
  and never reserves or launches it as a fresh attempt automatically

### Requirement: Cross-provider composition is visible and repairable

Flapstack SHALL preview the resolved target, context, permissions, worktree,
budget, descendants, and capability limits and SHALL preserve child Chat lineage,
results, diagnostics, and exact repair reasons after launch.

#### Scenario: Provider capability changes after preview

- **WHEN** launch-time probe no longer matches the approved preview
- **THEN** Flapstack expires the preview, performs no provider mutation, and asks
  the user to review compatible repair choices

#### Scenario: User inspects a delegated result from the parent Chat

- **WHEN** the result reference is selected
- **THEN** Flapstack navigates to the distinct child Chat or its durable result
  evidence without relabeling child-native activity as parent output

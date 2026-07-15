## ADDED Requirements

### Requirement: Layered agent profile composition

Flapstack SHALL keep capability profile, presentation personality, workflow
binding, and resolved runtime snapshot as independently versioned layers.

#### Scenario: Personality changes tone only

- **WHEN** a user changes an agent's presentation style from concise to explanatory
- **THEN** the resolved tools, permissions, memory, descendants, model ceiling,
  runtime, and worktree policy remain unchanged

### Requirement: Versioned custom agent profiles

Flapstack SHALL allow users to create, duplicate, edit, archive, search, and
version named local agent profiles with typed instructions and capabilities.

#### Scenario: Existing profile is edited after launch

- **WHEN** a user changes a profile that already has launched agents
- **THEN** future launches may use the new version while every historical and
  active agent retains its original immutable snapshot

### Requirement: Safe profile resolution

Flapstack SHALL resolve profile fields through the approved precedence contract,
show each field's source, and intersect requested capability with current task,
project, orchestration, permission, and runtime limits.

#### Scenario: Profile requests broader write permission

- **WHEN** a selected profile requests writes but the task policy is read-only
- **THEN** launch preview shows the conflict and the profile cannot widen the
  task policy without the existing explicit approval path

### Requirement: Workflow profile binding

Flapstack SHALL let each deterministic workflow step bind an exact agent profile
version with typed inputs, output schema, and bounded step overrides.

#### Scenario: Workflow resumes after profile edit

- **WHEN** a checkpointed workflow resumes after its source profile was edited
- **THEN** the step reuses its stored resolved snapshot unless the user
  explicitly forks or retries with the updated profile

### Requirement: Standalone named agent launch

Flapstack SHALL let users launch a named agent profile from a task, chat, or
Profile Studio using normal durable chat, run, lineage, and workspace ownership.

#### Scenario: User starts a specialist agent from a chat

- **WHEN** the user selects a compatible named profile and confirms its preview
- **THEN** Flapstack creates one durable agent chat/run, records the profile
  snapshot, and adds it to the current operation workspace when applicable

### Requirement: Evaluated starter agent types

Flapstack SHALL provide only a small versioned starter catalog whose capability,
safety, and supported model/runtime behavior have explicit evaluation evidence.

#### Scenario: User customizes a built-in type

- **WHEN** a user edits a read-only starter agent
- **THEN** Flapstack creates an independent user-owned copy and leaves the
  built-in version and historical snapshots unchanged

### Requirement: Trusted profile import and export

Flapstack SHALL export versioned secret-free profile bundles and SHALL parse,
validate, preview, and constrain imported profiles before they become launchable.

#### Scenario: Imported profile references unavailable authority

- **WHEN** an imported profile references a missing skill, hook, MCP server,
  persistent memory store, or unsupported runtime
- **THEN** those references remain disabled with exact reasons and import never
  enables or substitutes them silently

### Requirement: Honest profile compatibility and evaluation

Flapstack SHALL show profile source, version, runtime/model compatibility,
evaluation state, and unresolved requirements without claiming identical
behavior across models or exposing private chain-of-thought.

#### Scenario: Profile has not been evaluated on selected model

- **WHEN** a user selects an otherwise compatible but unevaluated model
- **THEN** preview labels the combination untested and follows the configured
  allow-or-block decision without inventing quality evidence

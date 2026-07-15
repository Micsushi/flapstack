## ADDED Requirements

### Requirement: One Agent Profile concept

Flapstack SHALL use Agent Profile as the complete named launch configuration and
SHALL treat built-in presets/templates only as starter profiles.

#### Scenario: User selects Reviewer

- **WHEN** Reviewer is selected for a new agent
- **THEN** one exact Agent Profile version supplies all capability defaults

### Requirement: Reusable versioned personalities

Flapstack SHALL store personality as non-executable versioned Markdown traits
that multiple profiles may reference without granting capability.

#### Scenario: Two profiles share Direct personality

- **WHEN** both launch from the same personality version
- **THEN** each keeps its own model/skills/permissions while sharing resolved style

### Requirement: Universal profile selection

Flapstack SHALL offer compatible exact Agent Profiles when starting a new chat,
direct sub-agent, or workflow worker.

#### Scenario: Parent requests Reviewer child

- **WHEN** the parent is allowed to spawn that profile
- **THEN** Flapstack resolves its stable ID/version and snapshots it for one child chat/run

### Requirement: Independent effort and speed controls

Flapstack SHALL resolve reasoning effort separately from provider-supported
speed/fast preference and SHALL expose compatibility before launch.

#### Scenario: Profile requests unsupported fast mode

- **WHEN** selected runtime/model lacks the capability
- **THEN** launch blocks with repair choices and does not silently change behavior

### Requirement: Immutable profile and personality history

Flapstack SHALL snapshot resolved profile capability and personality content for
each launch and SHALL not mutate active or historical agents after source edits.

#### Scenario: Shared personality is edited

- **WHEN** a new personality version is saved
- **THEN** existing agents retain the old snapshot and future previews may select the new version

### Requirement: Personality safety and trust

Flapstack SHALL keep personality separate from skills, tools, permissions,
memory, secrets, runtimes, worktrees, descendants, and workflow topology.

#### Scenario: Imported personality asks for shell access

- **WHEN** Markdown text requests capability escalation
- **THEN** it remains untrusted presentation text and grants no shell authority

## ADDED Requirements

### Requirement: Agent Runtime is independent from coordination and model

Flapstack SHALL model Agent Runtime independently from model, reasoning effort,
permission mode, and multi-agent coordination engine.

#### Scenario: Mixed-runtime workflow

- **WHEN** one workflow launches Codex, Claude Code, and generic-provider workers
- **THEN** each worker snapshots its compatible Agent Runtime while all workers
  remain governed by the same orchestration policy and Flapstack authority

### Requirement: Deterministic runtime resolution

Flapstack SHALL resolve runtime from chat preference, project per-harness
override, global per-harness preference, then product mapping and SHALL persist
the resolved runtime and adapter version before starting work.

#### Scenario: New Codex chat uses automatic selection

- **WHEN** a new chat selects the Codex harness and has no higher override
- **THEN** Flapstack resolves `codex`, previews it, and snapshots it on each run

#### Scenario: OpenAI model uses a generic provider

- **WHEN** an OpenAI model is selected through OpenRouter
- **THEN** Flapstack resolves `flapstack-native` because runtime compatibility is
  based on harness capability rather than model vendor

### Requirement: Capability-gated runtime choices

Flapstack SHALL expose only compatible runtimes as selectable and SHALL show an
exact unavailable reason without silent fallback.

#### Scenario: Direct Codex protocol is unavailable

- **WHEN** a chat explicitly requires `codex` but the installed Codex App Server
  fails its protocol capability probe
- **THEN** launch is blocked, `flapstack-native` remains an explicit alternative,
  and the stored preference is not changed

### Requirement: Lossless Codex runtime activity

Flapstack SHALL preserve displayable Codex App Server thread, turn, item,
reasoning, plan, tool, permission, usage, warning, and lifecycle events with
their native identity and ordering.

#### Scenario: Codex emits sectioned reasoning summaries

- **WHEN** Codex streams summary deltas and section boundaries for one item
- **THEN** Flapstack persists the thread, turn, item, summary index, sequence,
  section boundaries, and displayable text and renders the same sections in order

#### Scenario: Codex emits private reasoning

- **WHEN** Codex supplies encrypted or non-displayable reasoning metadata
- **THEN** Flapstack retains only permitted opaque metadata and never renders or
  reconstructs private chain-of-thought

### Requirement: Native Claude Code activity

Flapstack SHALL preserve Claude Agent SDK content blocks, session/message
identity, tools, permissions, hooks, subagent provenance, usage, and
provider-visible thinking without representing thinking as a tool call.

#### Scenario: Claude child activity is enabled without reasoning display

- **WHEN** subagent activity is enabled and reasoning display is disabled
- **THEN** child status and messages remain visible while thinking text stays hidden

### Requirement: Stable Flapstack Native compatibility

Flapstack SHALL retain the Stage 3 normalized pipeline as `flapstack-native` for
generic harnesses, explicit compatibility selection, legacy history, and rollback.

#### Scenario: Existing Stage 3 chat opens after migration

- **WHEN** a historical chat has no runtime snapshot
- **THEN** it renders with legacy Flapstack Native semantics without rewriting or
  duplicating its messages

### Requirement: Durable provider-neutral activity envelope

Flapstack SHALL append bounded activity events with run/runtime provenance,
provider identities, kind, phase, sequence, timestamps, indices, display class,
and privacy classification.

#### Scenario: App restarts during a streamed turn

- **WHEN** Flapstack restarts after persisting some activity and provider intent
- **THEN** persisted activity remains ordered, the run reconciles through its
  adapter, and no uncertain turn is replayed automatically

### Requirement: Safe runtime switching

Flapstack SHALL allow an empty chat to change runtime in place and SHALL require
a new chat branch/provider session after the first provider turn.

#### Scenario: User changes runtime after conversation begins

- **WHEN** a completed Codex chat selects `flapstack-native`
- **THEN** Flapstack offers `Continue with Flapstack Native`, creates a new chat
  and provider session with explicit history context, and leaves the source
  chat and its run snapshots unchanged

#### Scenario: User changes runtime during an active run

- **WHEN** a runtime change is requested while a run is active
- **THEN** Flapstack blocks the change until the run reaches a terminal state

### Requirement: Runtime-aware shared rendering

Flapstack SHALL use one accessible transcript/activity surface with
runtime-specific formatting and independent effort, display, subagent, and hook
controls.

#### Scenario: Completed reasoning collapses

- **WHEN** a runtime reasoning block completes
- **THEN** the compact row collapses by default, remains keyboard accessible,
  and expands without losing native section labels or provenance

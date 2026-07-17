## MODIFIED Requirements

### Requirement: Deterministic runtime resolution

Flapstack SHALL resolve Runtime preference from chat, project, global, then
product defaults; SHALL distinguish provider parity, provider enhanced, and
Flapstack Native behavior; and SHALL persist the selected preference and actual
transport adapter before starting work.

#### Scenario: Automatic Codex selection

- **WHEN** a Codex Chat has no explicit Runtime override
- **THEN** Flapstack inherits any project or global Runtime default, otherwise
  selects Codex provider parity
- **AND** the first provider launch pins the concrete preference and resolved
  transport on the Chat and run

#### Scenario: User changes provider defaults

- **WHEN** the user selects a global or project Runtime default for Codex or
  Claude Code in Settings
- **THEN** new Automatic Chats inherit that default
- **AND** existing started Chats keep their pinned Runtime

#### Scenario: Codex Enhanced selection

- **WHEN** a Codex Chat selects `codex-enhanced`
- **THEN** Flapstack snapshots `codex-enhanced`, resolves transport `codex`, and
  applies the enhanced launch policy without creating a second Codex adapter

### Requirement: Capability-gated runtime choices

Flapstack SHALL expose Codex, Codex Enhanced, Claude Code, Claude Code Enhanced,
and Flapstack Native only for compatible harnesses and SHALL show an exact
unavailable reason without silent fallback.

#### Scenario: Claude Chat opens Runtime choices

- **WHEN** the Claude Code harness is selected
- **THEN** the selectable choices are Automatic, Claude Code, Claude Code
  Enhanced, and Flapstack Native

### Requirement: Provider-parity runtime behavior

Flapstack SHALL preserve the observable native provider runtime prompt,
instruction discovery, settings, tools, sessions, events, permissions, and
controls without injecting Flapstack startup, vault, or managed-extension
instructions into provider-parity mode.

#### Scenario: Codex parity starts a new thread

- **WHEN** a Codex parity run starts
- **THEN** Codex chooses its model-catalog base instructions and native
  `AGENTS.md` context, and Flapstack sends no startup bundle as developer
  instructions

#### Scenario: Claude Code parity starts a query

- **WHEN** a Claude Code parity run starts
- **THEN** the Claude Code system-prompt preset and user/project/local setting
  sources are enabled without appended Flapstack startup or vault instructions

### Requirement: Provider-enhanced runtime behavior

Flapstack SHALL apply its startup context, vault context, response behavior,
managed extensions, hooks, and policy only when the matching Enhanced Runtime
preference is selected.

#### Scenario: Claude Code Enhanced starts a query

- **WHEN** `claude-code-enhanced` starts
- **THEN** it uses the same Claude Agent SDK transport and native preset while
  appending the approved Flapstack context and managed extension policy

### Requirement: Safe runtime switching

Flapstack SHALL treat parity, enhanced, and Native preferences as distinct
session behavior and SHALL require a new Chat/provider session after provider
intent when any of them changes.

#### Scenario: Started Codex parity Chat selects Codex Enhanced

- **WHEN** the Chat already has provider intent
- **THEN** Flapstack offers a Codex Enhanced continuation and does not reuse the
  existing Codex session in place

## ADDED Requirements

### Requirement: Runtime identity remains truthful

Flapstack SHALL distinguish the selected behavior preference from the transport
adapter and SHALL NOT claim parity with undisclosed provider UI or server
instructions.

#### Scenario: Diagnostics inspect Codex Enhanced

- **WHEN** a run selected `codex-enhanced`
- **THEN** diagnostics show preference Codex Enhanced and resolved transport
  Codex with the exact adapter/protocol versions

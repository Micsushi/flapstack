## ADDED Requirements

### Requirement: Permission Change Confirmation

The system SHALL persist a chat permission change behavior of `ask`,
`all-chats`, or `current-chat`, SHALL resolve missing or invalid behavior to
`ask`, and SHALL obtain an explicit scope before applying a chat-selector change
when behavior is `ask`.

#### Scenario: Fresh profile asks with all chats preselected

- **WHEN** a user with no remembered permission-change behavior selects a new
  permission mode in a chat
- **THEN** no mutation occurs yet and a confirmation opens with `All chats`
  preselected and `Remember my choice` unchecked

#### Scenario: Apply without remembering

- **WHEN** the user confirms either scope without checking `Remember my choice`
- **THEN** the selected scoped mutation runs and the next chat-selector change
  asks again

#### Scenario: Remember all chats

- **WHEN** the user applies `All chats` with `Remember my choice` checked
- **THEN** behavior becomes `all-chats` and later chat-selector changes use that
  scope without reopening the confirmation

#### Scenario: Remember this chat only

- **WHEN** the user applies `This chat only` with `Remember my choice` checked
- **THEN** behavior becomes `current-chat` and later chat-selector changes use
  that scope without reopening the confirmation

#### Scenario: Cancel permission change

- **WHEN** the user cancels the permission scope confirmation
- **THEN** the selector returns to its stored mode and no permission or behavior
  value changes

#### Scenario: Reset remembered behavior

- **WHEN** the user selects `Ask every time` in Settings
- **THEN** any remembered scope is cleared and the next chat-selector change
  opens the confirmation

### Requirement: Permissions Settings Management

The system SHALL provide a dedicated Settings page that exposes the
future-chat default, permission-change behavior, and active and archived chat
permission values, and SHALL allow direct editing of one named chat without
applying remembered global behavior.

#### Scenario: Change the future-chat default

- **WHEN** the user changes `Default permission for new chats` in Settings
- **THEN** the global default changes and existing chats remain unchanged

#### Scenario: Inspect different chat permissions

- **WHEN** the user opens the Permissions Settings page
- **THEN** active and archived chats show their identity, project/task context,
  archive status, and stored permission mode and can be filtered by chat,
  project, or task text

#### Scenario: Edit one chat from Settings

- **WHEN** the user changes a listed chat's permission in Settings
- **THEN** only that chat and its internal canonical-conversation rows change,
  regardless of the remembered chat-selector behavior

#### Scenario: Permission mutation refreshes visible state

- **WHEN** a scoped permission mutation succeeds
- **THEN** Settings, active and archived chat lists, input-bar resolution, and
  affected project/task defaults refetch without a manual reload

## MODIFIED Requirements

### Requirement: Permission Modes

The system SHALL support the permission modes `read-only`,
`ask-before-edits`, `auto-edit-project-only`, `full-access`, and `custom`.
Current-chat custom changes SHALL store an exact validated toggle object for
file write, shell, network, git, browser, MCP tools, and secrets access. The
system SHALL map each mode to the closest conservative native
controls of the launching harness, and SHALL record the effective mapping and
any limitations for every run. An unavailable or unknown native control MUST
fail closed or degrade conservatively; it MUST NOT silently widen access.

#### Scenario: Read-only Claude run

- **WHEN** a Claude Code run launches with mode `read-only`
- **THEN** the harness is configured so file edits are not permitted

#### Scenario: Ask-before-edits prompts

- **WHEN** an agent in `ask-before-edits` mode attempts a file edit
- **THEN** the closest provider approval mechanism is used and any behavior
  that can auto-approve a subset of actions is shown as a limitation

#### Scenario: Unsupported control degrades visibly

- **WHEN** a custom toggle cannot be enforced by the selected harness
- **THEN** the UI marks that control as best-effort instead of silently
  ignoring it

#### Scenario: Codex mode is applied

- **WHEN** a Codex run launches with `read-only`,
  `auto-edit-project-only`, or `full-access`
- **THEN** Flapstack selects the corresponding ACP `read-only`, `agent`, or
  `agent-full-access` mode and records that native mode

#### Scenario: Codex approval bridge is missing

- **WHEN** Codex raises a permission request and the Flapstack approval bridge
  is missing, disconnected, cancelled, timed out, or cannot recognize the
  available options
- **THEN** the request is rejected or cancelled and the first option is never
  selected implicitly

#### Scenario: OpenCode receives an unknown tool

- **WHEN** OpenRouter or NanoGPT runs in a non-full-access mode and OpenCode
  evaluates an unknown or MCP tool name
- **THEN** the mode's catch-all rule denies or asks instead of inheriting a
  permissive provider default

#### Scenario: Read-only caller uses product MCP

- **WHEN** a read-only run calls a registry-classified Tier 0 Flapstack product
  MCP tool
- **THEN** that read may run while third-party MCP and product mutation tools
  remain denied

#### Scenario: Product classification ignores an untrusted display-name collision

- **WHEN** a third-party MCP server uses the `flapstack` display name
- **THEN** provider permissions classify it from trusted registration and
  origin identity, not the name
- **AND** it remains third-party and receives no product Tier 0 privilege

#### Scenario: Product MCP approval is correlated

- **WHEN** an ask-before-edits run invokes a Tier 1 or Tier 2 product MCP tool
- **THEN** the provider and product gates produce one correlated user decision
  and never two prompts for the same invocation

#### Scenario: Product Tier 3 remains mandatory

- **WHEN** a provider-native mode would allow a Tier 3 product MCP call
- **THEN** the separate Stage 3 product approval is still required

### Requirement: Resolved Mode Visibility

The UI SHALL show the selected permission mode, active permission-change
behavior, closest provider-native mapping, and any degradation before an agent
run launches.

#### Scenario: Pre-launch display

- **WHEN** the user views the chat input bar
- **THEN** the permission mode for the next run and whether the next change will
  ask, apply to all chats, or apply only to the current chat are visible

#### Scenario: Provider-specific limitation

- **WHEN** the selected provider cannot enforce the chosen mode exactly
- **THEN** the warning names that provider, the native controls applied, and the
  missing guarantee

### Requirement: Copy-On-Create Permission Inheritance

Permission defaults SHALL flow global -> project -> task -> chat/run by copying
the applicable current default at creation time. After the confirmation layer
resolves an explicit `all-chats` or `current-chat` scope, the system SHALL apply
the permission change according to that scope.

#### Scenario: Existing child keeps its mode after a default-only change

- **WHEN** a project, task, or global future-chat default changes without an
  all-chat synchronization
- **THEN** an existing chat keeps its stored mode

#### Scenario: New child copies current applicable default

- **WHEN** a chat is created after its applicable default changed
- **THEN** the new chat copies the current project, task, or global default

#### Scenario: Apply an all-chat permission change

- **WHEN** the user confirms or has remembered `all-chats` for a chat permission
  change
- **THEN** the global default, every project and task default, every active and
  archived chat, and every internal canonical-conversation row are updated to
  that mode

#### Scenario: Future chat after global synchronization

- **WHEN** a new chat is created after an all-chat permission change
- **THEN** it copies the synchronized mode from its applicable default

#### Scenario: Apply a current-chat permission change

- **WHEN** the user confirms or has remembered `current-chat` for a chat
  permission change
- **THEN** only that chat and its internal canonical-conversation rows change
  and parent defaults and other chats remain unchanged

#### Scenario: Apply current-chat custom capabilities

- **WHEN** the user applies `custom` with a complete exact toggle object to the
  current chat
- **THEN** that chat stores the mode and toggles and later runs/MCP calls reload
  the stored values instead of trusting launcher claims

#### Scenario: Leave custom mode

- **WHEN** a chat changes from `custom` to any non-custom mode
- **THEN** its stale custom JSON is cleared and cannot affect later runs

#### Scenario: Attempt all-chat custom without durable defaults

- **WHEN** the global, project, and task layers cannot persist the exact custom
  toggle schema and the user requests `all-chats` with `custom`
- **THEN** the operation is rejected without changing any permission row

#### Scenario: Historical and in-flight runs

- **WHEN** permissions change while prior or active runs exist
- **THEN** historical and in-flight runs keep their launch-time permission
  snapshot and only subsequently launched runs use the new mode

#### Scenario: Synchronization failure

- **WHEN** any required all-chat persistence step fails
- **THEN** the operation reports failure and restores the prior global config
  instead of reporting a partially synchronized success

## ADDED Requirements

### Requirement: Release-Eligible Settings Visibility

The system SHALL expose a Settings tab or control in release builds only when
its persistence path, runtime consumer, honest unavailable state, automated
coverage, and required live or packaged evidence pass the feature's promotion
gate.

#### Scenario: Hidden feature is unreachable from Settings

- **WHEN** a tab or control does not pass its promotion gate
- **THEN** it is absent from navigation and search, and a stored or direct tab
  ID normalizes to a visible safe tab

#### Scenario: Hiding preserves stored data

- **WHEN** an existing profile contains a value for a hidden feature
- **THEN** hiding the feature does not delete, reset, or rewrite that value

#### Scenario: Retired preference cannot remain active invisibly

- **WHEN** a hidden preference would otherwise change release runtime behavior
- **THEN** the runtime ignores that preference or applies a documented safe
  compatibility value until migration is implemented

#### Scenario: Feature promotion uses evidence

- **WHEN** a hidden feature is proposed for release visibility
- **THEN** focused persistence/consumption tests and the required verified-dev
  or packaged smoke are recorded before it becomes visible

### Requirement: Executable Keyboard Shortcut Settings

The system SHALL derive every displayed editable keyboard shortcut from the
same registered action, resolved binding, and runtime handler used to execute
that shortcut.

#### Scenario: Edit a working shortcut

- **WHEN** the user assigns a valid non-conflicting binding to an editable
  action
- **THEN** the binding persists, the displayed value updates, and the runtime
  action uses it without restart

#### Scenario: Reject a conflict

- **WHEN** a proposed binding conflicts with another active action or an
  unsupported OS-reserved combination
- **THEN** Settings rejects the save and names the conflict without changing
  the previous binding

#### Scenario: Respect focused input policy

- **WHEN** a shortcut is pressed while focus is in an input, terminal, Monaco,
  dialog, or modal surface
- **THEN** the registered action's focus policy determines whether it runs and
  ordinary text input is not stolen

#### Scenario: Unimplemented action is not editable

- **WHEN** an action has no available runtime handler in the current build
- **THEN** it is hidden or labeled unavailable and cannot accept a binding

### Requirement: Voice Settings Control the Active Speech Runtime

The system SHALL apply Voice adapter, model, offline preference, voice, and
playback-rate settings through the same resolved state used by dictation,
assistant-message playback, and Voice History.

#### Scenario: Adapter and model stay paired

- **WHEN** the user selects a speech adapter and model
- **THEN** the runtime uses that available pair or reports its unavailable or
  download state without silently substituting a differently labeled engine

#### Scenario: Prefer offline changes resolution

- **WHEN** the user enables Prefer offline and a compatible local adapter is
  available
- **THEN** new speech sessions resolve the local adapter ahead of a cloud
  adapter

#### Scenario: Playback rate is global

- **WHEN** the user changes Voice playback rate
- **THEN** subsequent assistant-message and history playback use the same rate,
  and active playback restarts or updates according to the documented policy

#### Scenario: Insert history into a chat draft

- **WHEN** the user activates Insert for a Voice History transcript while
  Settings is open
- **THEN** Settings closes, the intended chat composer mounts, and the transcript
  is appended to its draft exactly once

#### Scenario: History target is unavailable

- **WHEN** the intended chat or draft target no longer exists
- **THEN** the transcript is copied or otherwise preserved and the UI reports
  that it was not inserted

#### Scenario: Stream tentative and committed dictation

- **WHEN** the warm local streaming sidecar emits tentative and committed text
- **THEN** both new-chat and active-chat composers replace tentative text in
  order, preserve the pre-dictation draft, and never auto-send

#### Scenario: Dictation origin survives navigation

- **WHEN** recording continues while the user changes chat, project, or Settings
- **THEN** committed text remains bound to the immutable origin and the app shows
  a return/stop handoff instead of inserting into the newly visible composer

#### Scenario: Final transcript enters history

- **WHEN** dictation finalizes
- **THEN** searchable transcript, origin, adapter/model, timing, and optional
  local WAV metadata persist for copy, insert, play, reveal, and delete

### Requirement: Encrypted Main-Process Credential Storage

The system SHALL keep provider credentials out of renderer-readable persistent
storage and SHALL expose credential mutation and status through a write-only
main-process boundary.

#### Scenario: Store an encrypted credential

- **WHEN** OS-backed encryption is available and the user saves a credential
- **THEN** the main process encrypts and atomically persists it, and the
  renderer receives only configured status and a non-secret fingerprint

#### Scenario: Encryption is unavailable

- **WHEN** OS-backed encryption is unavailable or does not meet the supported
  security policy
- **THEN** Settings offers an explicitly labeled session-only path or refuses
  persistence and never writes plaintext silently

#### Scenario: Migrate a legacy renderer credential

- **WHEN** a known legacy localStorage credential exists
- **THEN** the renderer removes it only after the main process acknowledges a
  verified encrypted copy

#### Scenario: Migration fails

- **WHEN** encrypted persistence or verification fails
- **THEN** the legacy value remains available for retry, the failure is visible,
  and no successful migration is reported

#### Scenario: Renderer requests credential status

- **WHEN** Settings displays a configured provider
- **THEN** it receives status, source, update time, and an optional short
  fingerprint but cannot retrieve plaintext through the exposed API

#### Scenario: Replacement retires legacy provider sources

- **WHEN** the user accepts a replacement provider credential, including a
  session-only replacement
- **THEN** legacy file and OS-store sources are removed or durably tombstoned
  so restart cannot resurrect the replaced value
- **AND** any retained failed-migration source for Codex, Voice, custom Claude,
  or another supported provider is retired before the replacement becomes
  authoritative

#### Scenario: Concurrent credential mutations have one order

- **WHEN** synchronous and asynchronous set or clear operations overlap for one
  provider
- **THEN** invocation order is authoritative and an older completion cannot
  overwrite or resurrect the newest requested state

#### Scenario: Newest credential mutation fails before acceptance

- **WHEN** a newer set or clear cannot update the main credential state while
  an older asynchronous OS-store write is still completing
- **THEN** desired and OS-store state return to the last successfully applied
  mutation instead of publishing the failed request

### Requirement: Provider-Scoped Extension Settings

The system SHALL identify skills, commands, plugins, custom agents, and MCP
extensions by provider, kind, and stable source identity, and SHALL expose only
operations supported by that provider adapter.

#### Scenario: Same-name extensions stay distinct

- **WHEN** two providers publish extensions with the same display name
- **THEN** Settings lists distinct provider-scoped identities without merging
  or overwriting them

#### Scenario: Provider is read-only

- **WHEN** a provider supports discovery but not mutation for an extension kind
- **THEN** Settings labels the inventory read-only and hides create, edit, and
  delete actions

#### Scenario: Provider supports runtime installation

- **WHEN** the user enables or installs a supported provider extension
- **THEN** the provider runtime consumes the exact selected identity and
  Settings reflects the resulting state

#### Scenario: Provider capability is unknown

- **WHEN** capability discovery fails or returns an unknown format
- **THEN** Settings fails closed, reports the limitation, and does not expose a
  mutation control

#### Scenario: MCP extension kind is listed

- **WHEN** Settings discovers an `mcp` provider extension
- **THEN** it represents a third-party harness configuration and never merges
  with the product app-control or development test-control MCP identity

#### Scenario: Third-party MCP uses a reserved display name

- **WHEN** a third-party server is named `flapstack`
- **THEN** its trusted provider origin and registration keep it classified as
  third-party without product privileges
- **AND** an ambiguous collision fails closed or requires an explicit rename
  instead of silently reclassifying or deleting the user entry

### Requirement: Permission Mode Eligibility

The system SHALL offer a permission mode as a new selection only when the
selected provider can enforce its declared contract or the UI explicitly
offers a conservative ask/deny mapping allowed by that mode's specification.

#### Scenario: Existing hidden permission value

- **WHEN** a chat or default contains a currently ineligible permission mode
- **THEN** Settings displays `Legacy mode - change required`, preserves the
  stored value until the user chooses an eligible mode, and does not offer the
  legacy value as a new selection

#### Scenario: Configure custom capabilities

- **WHEN** `custom` is eligible and the user selects it
- **THEN** Settings exposes explicit project-edit, shell, network,
  external-path, subagent, and MCP-risk capabilities whose stored values are
  consumed by every supported provider mapping

#### Scenario: Current-chat custom storage

- **WHEN** the user selects custom for one chat with a complete capability set
- **THEN** only that chat stores the exact toggles and subsequent runs reload
  them from durable state

#### Scenario: All-chat custom lacks hierarchy defaults

- **WHEN** global, project, and task defaults cannot persist the custom schema
- **THEN** all-chat custom remains unavailable and no chat/default is changed

#### Scenario: Leave custom mode

- **WHEN** the user selects a non-custom mode
- **THEN** stale custom JSON for the affected chat scope is cleared

#### Scenario: Exact project-only provider

- **WHEN** the selected provider has a tested exact project boundary
- **THEN** `auto-edit-project-only` may be selected for that chat and outside
  boundary actions ask or deny according to the provider mapping

#### Scenario: Best-effort project boundary

- **WHEN** the selected provider only offers cwd hints, classifiers, or another
  unprovable boundary
- **THEN** `auto-edit-project-only` remains unavailable for new selection and
  the provider limitation is reported

### Requirement: Accurate Settings Copy and Search

The system SHALL derive visible Settings labels, provider scope, search
metadata, and target IDs from the same visibility and capability facts used to
render each control.

#### Scenario: Provider-neutral setting

- **WHEN** a control affects more than one provider
- **THEN** its title and description use provider-neutral terminology and name
  provider-specific limitations separately

#### Scenario: Provider-specific setting

- **WHEN** a control affects only one provider
- **THEN** its copy and provider badge name that scope explicitly

#### Scenario: Hidden control is searched

- **WHEN** a query matches a hidden or unavailable control
- **THEN** search returns no result for that control

#### Scenario: Visible control is searched

- **WHEN** a query matches a visible control label, description, provider, or
  curated alias
- **THEN** search opens the same visible control and stable target represented
  by the registry

#### Scenario: Hidden attachment content is represented as message JSON

- **WHEN** current or legacy development-message JSON contains a hidden
  `file-content` part
- **THEN** visible rendering, Settings search, and clipboard/history export
  sanitize the part before serialization or display
- **AND** agent transport may retain the hidden payload only on its private
  execution path

# Design: Settings Reliability and Feature Promotion

## Context

Settings tabs are currently registered in the sidebar, routed independently in
the content switch, and indexed independently for search. Controls also read
and write atoms that may not have complete runtime consumers. This allows a
feature to disappear from one surface but remain reachable from a persisted tab
ID, search result, shortcut, or provider-specific path.

Three active areas need explicit coordination:

- Voice is owned by `add-stage2-voice-usage-cursor`; this change owns the
  Settings-facing correctness and promotion evidence, not a second speech
  architecture.
- Provider permission synchronization is owned by
  `sync-provider-permissions-globally`; this change keeps incomplete choices
  hidden and defines the follow-on eligibility gates.
- Provider integrations already differ. Settings must expose honest scoped
  capability rather than claiming parity that a provider does not have.

## Goals

- Make every visible setting produce an observable, persistent runtime effect.
- Keep unfinished implementation available to developers without presenting it
  as a release feature.
- Preserve existing stored values during hiding and migrate them only through
  explicit, verified feature work.
- Use provider capability facts for labels, selectable options, and search.
- Make each feature independently pickup-ready and testable.

## Non-Goals

- Delete legacy tab components, stored atoms, or compatibility data during the
  hiding phase.
- Rewrite the underlying Voice or provider-permission proposals.
- Claim identical provider support where exact parity is impossible.
- Build Stage 4 cross-provider extension portability, shared authoring
  templates, project/task policy, or the unified hook manager.
- Install a new secret manager when Electron `safeStorage` and OS credential
  facilities meet the platform gate.
- Re-enable a feature based only on component rendering or unit tests that do
  not reach its runtime consumer.

## Decisions

### 1. Visibility is a capability gate

Introduce one Settings release registry with tab/control identity, visibility,
search metadata, provider scope, and promotion evidence. The current hiding
patch starts with a typed hidden-tab list and explicit removal of unsafe
controls. The registry becomes the shared source for sidebar navigation,
content normalization, search, and future deep links.

A feature is promotable only when all of these are true:

1. its write path persists successfully;
2. its runtime consumer reads the persisted value;
3. invalid and unavailable states fail honestly;
4. focused tests cover persistence and consumption;
5. the verified dev profile proves the user path;
6. packaged checks pass when native binaries, secure storage, or OS APIs are
   involved.

Hidden direct tab IDs normalize to Preferences. Hidden controls remain absent
from search. Persisted values remain untouched until their owning feature
implements a migration.

### 2. Keyboard shortcuts use one action and binding registry

Replace component-local shortcut descriptions with a registry whose entry owns:

- stable action ID and display metadata;
- default macOS, Windows, and Linux binding;
- runtime handler registration and availability predicate;
- editable/reserved status;
- focus policy for text inputs, dialogs, and modal surfaces;
- conflict group and priority.

Persist normalized bindings by action ID and schema version. Validate modifier
order, platform aliases, duplicate conflicts, and OS-reserved combinations
before saving. A reset removes only that action override. Runtime handlers read
the same resolved binding shown in Settings and update without restart.

The rebuilt Keyboard page lists only registered actions. An action with no
runtime handler is unavailable, not editable. Tests dispatch real keyboard
events through the manager and assert the resulting action, including dialog
and input-focus exclusions.

### 3. Voice Settings write through canonical runtime services

Voice preference state must have one canonical owner for adapter, model,
offline preference, playback voice, and playback rate. Renderer controls call a
typed service; speech adapter resolution and message/history playback consume
the same resolved state.

- Adapter and model selectors list only installed/available pairs. Selecting
  Whisper cannot silently resolve to Parakeet, and unavailable local models
  display their download/error state.
- `Prefer offline` changes adapter resolution order and is covered by resolver
  tests.
- The global playback rate is consumed by ordinary assistant-message playback,
  Voice History playback, and restart-on-voice/rate-change behavior.
- Voice History `Insert` captures the current chat and draft target, closes
  Settings, then appends the transcript after the composer is mounted. If the
  target no longer exists, it copies the text and reports the fallback instead
  of silently succeeding.
- History mutation uses stable IDs and reports persistence errors.

The work extends the active Voice change and its storage contracts rather than
introducing a parallel speech store.

### 4. Secrets live behind main-process IPC

Add a main-process credential service keyed by provider and purpose. Renderer
code can request status, set, replace, or remove a credential, but cannot read
the stored plaintext back. At rest, secrets are encrypted with Electron
`safeStorage` and stored in an app-data file containing ciphertext plus schema
metadata. The file is written atomically with restrictive permissions.

When encryption is unavailable, the service offers an explicitly labeled
session-only credential held in main-process memory. It does not silently write
plaintext. On platforms where `safeStorage` reports a weak/basic backend, the
UI reports that state and uses the policy selected during implementation.

Legacy migration is acknowledged:

1. renderer reads the known legacy localStorage keys once;
2. renderer sends each non-empty value through the write-only IPC;
3. main process encrypts, persists, decrypts internally, and returns a
   fingerprint/status acknowledgment;
4. renderer clears that legacy key only after the acknowledgment matches;
5. failures leave the original value and expose retry/removal guidance.

The safe editor returns only `configured`, source, last-updated time, and a
short fingerprint. It never repopulates a secret field.

### 5. Extensions have provider-scoped identity and capability

Define a provider extension manifest with provider, kind (`skill`, `command`,
`plugin`, `custom-agent`, `mcp`), source, stable source path/ID, display name,
read/write support, runtime availability, and limitations.

Compound identity is `(provider, kind, sourceId)`. Same-name items from two
providers remain distinct. Discovery adapters map Claude, Codex, Cursor, and
OpenCode-backed providers into the shared manifest without pretending they use
the same on-disk format.

Settings adds a provider target filter and provider badges. Create/edit/delete
actions appear only when the adapter supports them; read-only inventories are
labeled read-only. Plugin and Custom Agent tabs return only after at least one
provider path has an end-to-end runtime consumer and the tab copy names its
scope. Provider-specific support may ship independently when it is honest.

### 6. Permission options are eligibility-aware

The universally selectable release set remains `read-only`,
`ask-before-edits`, and `full-access` while the active synchronization change
finishes. Existing stored legacy modes remain valid backend values, but the UI
shows `Legacy mode - change required` and does not offer them as new choices.

`custom` returns only after Flapstack stores explicit capabilities such as
project edits, shell, network, external paths, subagents, and MCP risk tiers;
every provider adapter must map or conservatively ask/deny each capability.

`auto-edit-project-only` is selectable for a chat only when the selected
provider has a tested exact project boundary. It cannot be a global default
until all eligible future providers have a safe fallback. Best-effort cwd or
classifier behavior is disclosed as a limitation and does not pass the exact
promotion gate.

### 7. Copy and search derive from the same facts

Provider-neutral surfaces say “agent” or “provider” rather than “Claude” unless
the control truly changes Claude-only behavior. The visibility registry owns
search label, description, aliases, provider scope, and target ID. Search never
indexes a tab/control that the registry hides for the current build/provider.

Copy review includes notification text, mode descriptions, account labels,
plugin/skill/custom-agent scope, model/account terminology, and failure toasts.
Tests compare the visible registry with navigation and search coverage.

## Order and Dependencies

1. Finish S3-F7 release hiding and evidence.
2. S3-F8 Keyboard, S3-F9 Voice, and S3-F10 Credentials can proceed
   independently.
3. S3-F11 Provider Extensions follows its manifest/discovery contract.
4. S3-F12 Permission Modes starts after GPP-T4 and GPP-T6 close or the
   active permission change explicitly hands off ownership.
5. S3-F13 consolidates final copy/search metadata, runs the Settings matrix, and
   promotes only the features whose gates pass.

## Risks and Mitigations

- Persisted hidden values can keep affecting runtime. The hiding work explicitly
  makes the retired quick-switch preference inert; other stored values remain
  runtime-compatible until migrated.
- A secret migration can lose credentials. Never clear legacy storage before a
  verified encrypted acknowledgment.
- Shortcut behavior can steal text-editor input. Each action has a focus policy
  and integration tests for inputs, dialogs, terminals, and Monaco.
- Provider capability drift can make labels false. Capability fixtures fail
  closed and hide write controls when discovery is unknown.
- Permission labels can overstate sandbox boundaries. Exact enforcement is a
  promotion requirement, and limitations remain visible in preview/run data.

## Rollback

The visibility change can be reverted without data migration because no stored
values are deleted. Each later feature keeps schema-versioned migration and a
fallback reader until its rollback window closes. Credential rollback never
restores plaintext automatically; it retains encrypted data and provides an
explicit export/re-entry path if the old build cannot read it.

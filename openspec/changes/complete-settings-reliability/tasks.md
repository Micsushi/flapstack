# Settings Reliability Tasks

This is the sole authoritative checklist for the Stage 3 Settings repair
features. Stage and feature README files are navigation routers only.

## S3-F7 - Honest Settings Surface

### S3-F7-T1 - Gate hidden tabs and normalize stale tab IDs

- [x] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Honest Settings Surface
- Outcome: One typed release registry prevents Legacy Beta, Future Scaffolds,
  and retired Profile/Worktree routes from being reached through navigation,
  search, or stale stored IDs. Keyboard and Custom Agents are now visible only
  because their S3-F8 and S3-F11 promotion contracts landed.
- Scope: Add typed release metadata; derive sidebar, direct routing, and search
  from it; normalize hidden IDs to Preferences; remove the retired Beta-click
  devtools unlock path while retaining normal development Debug.
- Out of scope: Delete tab components, atoms, or stored data.
- Acceptance:
  - Hidden tabs are absent from sidebar and Settings search.
  - Promoted Keyboard and Custom Agents routes remain visible and searchable
    without weakening hidden-route normalization.
  - A hidden active tab normalizes to Preferences and updates the active tab.
  - Debug remains visible in development and hidden by the existing production
    gate.
  - No hidden component data or persisted setting is deleted.
- Verification: `tests/settings-search.test.ts`,
  `tests/settings-visibility.test.ts`, and TypeScript.
- Estimated effort: 2-3 hours.
- Blocked by: none.
- Blocks: S3-F7-T4, S3-F13-T2.
- Relevant context: `settings-sidebar.tsx`, `settings-content.tsx`,
  `settings-search.ts`, `settings-visibility.ts`.

### S3-F7-T2 - Hide unsafe and incomplete controls without data loss

- [x] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Honest Settings Surface
- Outcome: Plaintext credential editors, the retired quick-switch preference,
  and incomplete permission choices are no longer offered in Settings or run
  selectors.
- Scope: Remove Models API Keys/Override Model editor; remove Quick Switch from
  Preferences and make a persisted `agents` target inert; limit new permission
  choices to read-only, ask-before-edits, and full-access; label existing hidden
  modes as legacy-change-required.
- Out of scope: Clear existing keys, model overrides, quick-switch values, or
  permission values; implement secure credential migration.
- Acceptance:
  - Models contains no Codex/OpenAI/custom Claude secret editor.
  - Preferences contains no Quick Switch row and a persisted `agents` value
    cannot move Control-Tab away from chat switching.
  - `custom` and `auto-edit-project-only` are absent from selectable mode lists.
  - Existing chats using those modes remain readable and can be changed to an
    eligible value.
- Verification: `tests/settings-visibility.test.ts`, permission UI contract
  tests, and TypeScript.
- Estimated effort: 3-4 hours.
- Blocked by: none.
- Blocks: S3-F7-T4, S3-F10-T3, S3-F12-T1.
- Relevant context: Models, Preferences, Permissions tabs; chat input permission
  menu; `agents-content.tsx`; provider-neutral permission constants.

### S3-F7-T3 - Add permanent release-visibility regressions

- [x] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Honest Settings Surface
- Outcome: Tests fail if hidden surfaces reappear through tabs, search,
  permission options, credential editors, or quick-switch state.
- Scope: Add visibility-policy tests and hidden-search queries; retain existing
  navigation and permission UI contract tests.
- Out of scope: Browser screenshot or packaged-app automation.
- Acceptance:
  - Hidden tab normalization and safe visible tabs are covered.
  - Hidden permission option arrays are exact.
  - Source contracts detect plaintext credential-editor and retired preference
    reintroduction.
  - Focused suite executes under a supported Node runtime.
- Verification: focused Vitest suite, 17 tests passing.
- Estimated effort: 1-2 hours.
- Blocked by: S3-F7-T1, S3-F7-T2.
- Blocks: S3-F7-T4.
- Relevant context: `tests/settings-search.test.ts`,
  `tests/settings-visibility.test.ts`, `tests/settings-navigation.test.ts`,
  `tests/permission-ui-contract.test.ts`.

### S3-F7-T4 - Prove the hidden surface in the real app

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Honest Settings Surface
- Outcome: The release-facing hide is proven in the correct dev profile and the
  full repository gate passes.
- Scope: Run full `npm run check` with Node 22 CI parity; launch only with
  `npm run dev`; run `npm run dev:verify`; inspect navigation and search; seed or
  preserve representative legacy tab/permission/quick-switch values and verify
  safe behavior; record screenshots or exact observations.
- Out of scope: Packaged cross-OS matrix for features still hidden.
- Acceptance:
  - Full check passes under Node 22.
  - Dev verification names this checkout and `Flapstack Dev`.
  - Hidden tabs and controls are absent, including search queries.
  - Existing stored data remains present and hidden legacy permission values
    show change-required without becoming selectable.
- Verification: Node 22 full gate plus verified live dev smoke.
- Remaining verification: Node 22 `npm run check` passes with 61 test files,
  533 passing tests, 3 skipped tests, and a production build in the prior
  checkout. Current checkout `npm run dev:verify` identifies the correct
  worktree/profile and the production build passes, but the visual Settings
  smoke is blocked by the locked Mac. The current full gate also stops on
  unchanged Drizzle formatting plus three MCP migration tests owned outside
  this feature.
- Estimated effort: 0.5-1 day.
- Blocked by: S3-F7-T1, S3-F7-T2, S3-F7-T3.
- Blocks: S3-F8-T1 unless headless-only work is explicitly accepted;
  S3-F13-T4.
- Relevant context: root AGENTS live-dev rules, current local profile, full gate.

## S3-F8 - Keyboard Shortcuts

### S3-F8-T1 - Inventory actions and build the shortcut registry

- [x] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Keyboard Shortcuts
- Outcome: One registry describes every real shortcut action, platform default,
  availability, focus policy, and runtime handler identity.
- Scope: Inventory `agents-actions`, hotkey manager, sidebar/composer/window
  listeners, terminal/Monaco exclusions, and native menu accelerators; assign
  stable IDs; classify editable, fixed, unavailable, and duplicate handlers;
  add macOS/Windows/Linux defaults.
- Out of scope: Build the editor UI or change bindings.
- Acceptance:
  - Every displayed or runtime shortcut maps to one stable action ID.
  - Duplicate listeners and actions without handlers are documented.
  - Registry fixtures cover platform defaults and availability.
- Verification: registry unit tests and source inventory review.
- Estimated effort: 1 day.
- Blocked by: S3-F7-T4 or explicit acceptance of headless-only work.
- Blocks: S3-F8-T2, S3-F8-T3.
- Relevant context: `agents-hotkeys-manager.ts`, `agents-actions.ts`, keyboard tab,
  Electron menu/window listeners.

### S3-F8-T2 - Implement binding validation and persistence

- [x] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Keyboard Shortcuts
- Outcome: Users can save, reset, and immediately inspect valid custom bindings
  without silent conflicts.
- Scope: Version binding schema; normalize modifiers/platform aliases; capture
  key chords accessibly; reject duplicate and reserved bindings; support reset
  per action and reset all; preserve/migrate valid existing `customHotkeysAtom`
  data.
- Out of scope: Multi-step chord sequences.
- Acceptance:
  - Valid edits persist by stable action ID.
  - Conflicts name the existing action and do not overwrite it.
  - Reset restores the current platform default.
  - Invalid legacy bindings fall back safely and remain diagnosable.
- Verification: parser/conflict/migration tests and component interaction tests.
- Estimated effort: 1-1.5 days.
- Blocked by: S3-F8-T1.
- Blocks: S3-F8-T4.
- Relevant context: keyboard tab, Jotai storage schema, platform detection.

### S3-F8-T3 - Route runtime hotkeys through resolved bindings

- [x] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Keyboard Shortcuts
- Outcome: The runtime executes exactly the binding displayed in Settings and
  updates it without restart.
- Scope: Replace hard-coded duplicate listeners with registry resolution where
  editable; define action dispatch boundary; enforce focus policies for inputs,
  terminals, Monaco, menus, and dialogs; coordinate renderer/native menu
  accelerators; emit diagnostics for registration conflicts.
- Out of scope: OS-global shortcuts while Flapstack is unfocused.
- Acceptance:
  - Changing a binding disables the prior binding and enables the new one.
  - Text input and terminals keep ordinary keystrokes unless an action permits
    capture.
  - Native and renderer handlers never fire the same action twice.
- Verification: DOM keyboard-event integration tests and Electron menu contract
  tests.
- Estimated effort: 1-2 days.
- Blocked by: S3-F8-T1.
- Blocks: S3-F8-T4.
- Relevant context: hotkey manager, native menu, active chat/sidebar listeners.

### S3-F8-T4 - Restore Keyboard Settings and verify platforms

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Keyboard Shortcuts
- Outcome: The Keyboard tab returns only with working, conflict-safe shortcuts.
- Scope: Rebuild page from registry; show platform notation, availability, and
  conflicts; add search entries; run full gate; verify common actions on macOS
  and record Windows/Linux packaged checks as passed or remaining.
- Out of scope: Claim untested platform parity.
- Acceptance:
  - Every editable row has a runtime-consumption test.
  - Search opens the working Keyboard page.
  - Verified dev smoke covers edit, invoke, conflict, reset, input focus, and
    restart persistence.
- Verification: focused suite, full check, verified dev smoke, platform matrix.
- Remaining verification: registry/parser/runtime/editor tests, strict
  TypeScript, scoped lint/style, strict OpenSpec, verified dev identity, and the
  production build pass. Visual macOS smoke is blocked by the locked Mac;
  Windows/Linux package checks remain unavailable; the repository full gate is
  blocked by unchanged Drizzle formatting and three MCP migration tests.
- Estimated effort: 0.5-1 day.
- Blocked by: S3-F8-T2, S3-F8-T3.
- Blocks: S3-F13-T1, S3-F13-T4.
- Relevant context: Settings registry/search and package targets.

## S3-F9 - Voice Settings

S3-F9 now owns the unfinished Voice exit and streaming work formerly numbered
Stage 2 tasks 1.11 through 1.15. No second checklist owns that work.

### S3-F9-T1 - Replace default batch STT with warm Parakeet streaming

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Voice Settings
- Outcome: Local dictation uses a bundled warm Parakeet streaming sidecar with an
  explicit whisper.cpp fallback.
- Scope: Pinned model lifecycle; bundled native sidecar; committed/tentative PCM
  protocol; cancellation; idle unload; download/install/error states; adapter
  identity and fallback policy.
- Out of scope: Silent engine substitution or cloud-only dictation.
- Acceptance:
  - Tentative and committed segments are ordered and cancellation-safe.
  - The selected adapter/model matches runtime metadata.
  - Missing binary/model states are visible; whisper fallback is explicit.
- Verification: sidecar protocol/model lifecycle tests and real local dictation.
- Remaining verification: Node protocol tests and Rust sidecar tests pass; a real
  pinned-model load/start/chunked-speech/finalize/unload smoke passes with ordered
  committed output. Microphone speech, visible tentative revision, and timed
  idle-unload remain manual.
- Estimated effort: 2-3 days.
- Blocked by: none.
- Blocks: S3-F9-T2, S3-F9-T5.
- Relevant context: speech registry/resolver, STT sidecars, model store, package resources.

### S3-F9-T2 - Stream dictation into both immutable conversation drafts

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Voice Settings
- Outcome: Tentative and committed speech updates the intended new-chat or active
  chat draft without losing pre-dictation text or crossing conversation origin.
- Scope: Wire streaming segments into both composers; preserve initial draft;
  replace tentative text with committed text; review-before-send; cancellation;
  navigation-safe immutable origin and background recording handoff.
- Out of scope: Automatic send or cross-device dictation.
- Acceptance:
  - Both composers show ordered tentative/committed updates.
  - Existing draft text survives start, cancel, and completion.
  - Navigation never inserts into a different conversation.
- Verification: streaming draft/origin tests and live navigation dictation smoke.
- Remaining verification: focused draft/origin ownership tests pass. Live speech
  in both composers and navigation/background handoff remain manual.
- Estimated effort: 1-2 days.
- Blocked by: S3-F9-T1.
- Blocks: S3-F9-T3, S3-F9-T5.
- Relevant context: draft atoms, immutable dictation origins, recording capsule.

### S3-F9-T3 - Persist searchable Voice History and reliable mutations

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Voice Settings
- Outcome: Final transcripts, metadata, and optional local WAV files are
  searchable and support reliable copy, insert, play, reveal, and delete.
- Scope: Stable history IDs; transcript/origin/adapter/model/timing metadata;
  optional WAV lifecycle; search; insertion after composer mount; missing-target
  copy-and-warning fallback; atomic CRUD and error state.
- Out of scope: Cloud or cross-device history sync.
- Acceptance:
  - Finalized records survive restart and search by transcript/context.
  - Insert appends exactly once without replacing draft text.
  - Failed/missing targets preserve transcript; CRUD never reports false success.
- Verification: history store/component/CRUD tests and verified live history flow.
- Remaining verification: schema migration, target-bound insertion, missing-target
  preservation, search metadata, and focused tests pass. Live restart and all UI
  actions remain manual.
- Estimated effort: 1-2 days.
- Blocked by: S3-F9-T2.
- Blocks: S3-F9-T5.
- Relevant context: Voice History, desktop navigation, draft atoms, local WAV storage.

### S3-F9-T4 - Make Voice settings control canonical runtime state

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Voice Settings
- Outcome: Adapter, model, offline preference, playback voice, and playback rate
  control the runtime behavior named by Settings.
- Scope: One canonical preference service; adapter/model availability; Prefer
  offline resolution; shared message/history playback voice and rate; migration
  of duplicate values; active-playback update/restart policy.
- Out of scope: Automatic read-aloud reintroduction.
- Acceptance:
  - Prefer offline changes adapter priority with a visible fallback.
  - Message and history playback consume the same supported voice/rate.
  - Invalid persisted values resolve visibly and safely.
- Verification: resolver, preference migration, playback controller tests, and
  manual message/history playback.
- Remaining verification: resolver, invalid-value, legacy-rate migration, and
  canonical playback tests pass. Manual message/history/preview playback remains.
- Estimated effort: 1-2 days.
- Blocked by: S3-F9-T1.
- Blocks: S3-F9-T5.
- Relevant context: Voice tab, speech settings service, message/history players.

### S3-F9-T5 - Run the complete Voice release matrix

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Voice Settings
- Outcome: Voice remains visible only when streaming, Settings, history, native
  packaging, licenses, and manual behavior are proven together.
- Scope: Focused/full tests; strict OpenSpec; dev identity; model download states;
  real inline dictation in both composers; navigation/background recording;
  playback; history CRUD; dependency/license review; packaged macOS sidecar/model
  inspection; truthful Windows/Linux/provider gaps.
- Out of scope: Fabricate unavailable cloud keys or platform evidence.
- Acceptance:
  - All S3-F9 scenarios pass in the verified `Flapstack Dev` profile.
  - Native binaries/models and license notices exist in the package under test.
  - Unavailable platform/provider rows remain explicitly unchecked.
- Verification: Voice suites, `npm run check`, `npm run dev:verify`, packaged
  matrix, and recorded manual evidence.
- Remaining verification: focused suites, Rust tests, strict OpenSpec, real
  sidecar smoke, database migration, and verified dev identity pass. The Node 22
  full gate reaches 79 passing test files and 629 passing tests, then fails three
  unrelated MCP migration/append-only assertions because this base has
  `0016_glamorous_deathbird.sql` while the tests require
  `0016_massive_ravenous.sql`. Packaged-app launch, live Voice UI, and unavailable
  OS rows remain open until actually observed; the arm64 Preview package
  binary/license inspection passes.
- Estimated effort: 1 day.
- Blocked by: S3-F9-T1, S3-F9-T2, S3-F9-T3, S3-F9-T4.
- Blocks: S3-F13-T1, S3-F13-T4, and Stage 3 exit.
- Relevant context: live-dev rules, package resources/licenses, Voice manual matrix.

## S3-F10 - Secure Credentials

### S3-F10-T1 - Add encrypted main-process credential service

- [x] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Secure Credentials
- Outcome: Provider secrets have a write-only renderer API and encrypted,
  atomic main-process persistence.
- Scope: Provider/purpose credential IDs; Electron safeStorage encryption;
  atomic restrictive file storage; set/remove/status IPC; in-memory decrypted
  lifetime; redacted logs/errors; session-only unavailable-encryption path.
- Out of scope: Cloud credential sync or renderer plaintext reads.
- Acceptance:
  - On-disk data contains no submitted plaintext.
  - Renderer API cannot fetch plaintext.
  - Interrupted writes preserve the prior valid store.
  - Unsupported/weak storage follows an explicit safe policy.
- Verification: credential service and leakage-contract suites cover ciphertext,
  restrictive permissions, atomic/corrupt-store failure, weak/unavailable
  storage, metadata redaction, and the write-only IPC surface; Node 22
  TypeScript and production build pass.
- Estimated effort: 2 days.
- Blocked by: none.
- Blocks: S3-F10-T2, S3-F10-T3.
- Relevant context: Electron main/preload boundaries, app data, safeStorage.

### S3-F10-T2 - Migrate legacy renderer credentials safely

- [x] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Secure Credentials
- Outcome: Existing Codex, OpenAI Voice, and custom Claude credentials move to
  encrypted storage without loss or premature deletion.
- Scope: Inventory legacy keys/readers; one-time renderer migration handshake;
  encrypt/persist/decrypt verification; fingerprint acknowledgment; clear each
  legacy key only after success; idempotent retry; remove transport reads from
  legacy atoms after migration window.
- Out of scope: Delete unrelated API Provider credentials already owned by a
  different secure store.
- Acceptance:
  - Success clears only the acknowledged legacy key.
  - Failure keeps the source and reports retry/removal guidance.
  - Repeated startup cannot duplicate or corrupt a credential.
  - Provider transports consume the main-process credential path.
- Verification: migration state-machine tests cover exact-key inventory,
  acknowledgement/fingerprint matching, source retention on failure, and
  idempotent retry; leakage contracts prove renderer transports no longer carry
  Codex or Claude secrets; focused provider/usage suites pass.
- Estimated effort: 1.5-2 days.
- Blocked by: S3-F10-T1.
- Blocks: S3-F10-T3, S3-F10-T4.
- Relevant context: `codexApiKeyAtom`, `openaiApiKeyAtom`,
  `customClaudeConfigAtom`, onboarding and provider transports.

### S3-F10-T3 - Add safe credential management UI

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Secure Credentials
- Outcome: Users can add, replace, remove, and understand credential state
  without the renderer retrieving stored plaintext.
- Scope: Provider-scoped credential rows; blank write-only input; configured
  badge/fingerprint/update time; replace/remove confirmation; session-only
  warning; auth priority copy; search registry; move Voice key ownership out of
  Models.
- Out of scope: Display/reveal stored secrets.
- Acceptance:
  - Reopening Settings never fills a secret field.
  - Remove updates transport/account state and status.
  - Session-only credentials are unmistakable and disappear on restart.
  - Subscription/API-key priority is accurate per provider.
- Verification: component and IPC integration tests plus verified live auth
  setup/removal with disposable test values.
- Remaining verification: provider-scoped management rows, replace/remove
  confirmation, fingerprint/update-time display, Voice ownership/search, and a
  live disposable-value setup/removal pass remain for this UI-owned task.
- Estimated effort: 1-2 days.
- Blocked by: S3-F7-T2, S3-F10-T1, S3-F10-T2.
- Blocks: S3-F10-T4.
- Relevant context: Models, API Providers, Voice, onboarding/login modals.

### S3-F10-T4 - Verify secure storage across package targets

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Secure Credentials
- Outcome: Encrypted persistence, migration, redaction, and provider consumption
  are proven in supported dev and packaged environments.
- Scope: Full tests; inspect data files/logs/crash metadata; restart persistence;
  safeStorage backend states; packaged macOS test; Windows/Linux matrix or
  truthful remaining evidence; rollback/recovery exercise.
- Out of scope: Claim OS-keychain security without platform evidence.
- Acceptance:
  - No test credential appears in renderer storage, app logs, or unencrypted
    files.
  - Restarted provider consumes the encrypted credential.
  - Migration and removal behave safely in packaged app.
- Verification: security tests, full check, package smoke and filesystem/log
  inspection.
- Remaining verification: macOS Preview arm64 packages and launches, and the
  exact worktree Dev profile passes `npm run dev:verify`; packaged
  credential migration/restart/removal, this Mac's actual Keychain-backed
  persistence, Windows/Linux, and rollback evidence remain unavailable. The
  full Node 22 suite is also blocked by the missing S3-F2-T6 migration artifact,
  outside this credential scope.
- Estimated effort: 1 day.
- Blocked by: S3-F10-T2, S3-F10-T3.
- Blocks: S3-F13-T1, S3-F13-T4.
- Relevant context: packaging, OS keychain availability, log redaction.

## S3-F11 - Provider-Scoped Extensions

### S3-F11-T1 - Define provider extension capability and identity contracts

- [x] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Provider-Scoped Extensions
- Outcome: Skills, commands, plugins, custom agents, and MCP entries have stable
  provider-scoped identities and explicit read/write/runtime capabilities.
- Scope: Shared manifest, compound identity, capability states, limitations,
  source metadata, schema versioning, duplicate-name fixtures, and an explicit
  third-party MCP kind that cannot collide with product/dev-control MCP identity.
- Out of scope: Implement every provider adapter.
- Acceptance:
  - Same-name cross-provider items remain distinct.
  - Unknown capability fails closed.
  - Schema supports read-only discovery and provider-specific mutation.
  - Product app-control and development test-control MCPs are excluded.
- Verification: contract/schema/identity tests.
- Estimated effort: 1-1.5 days.
- Blocked by: none.
- Blocks: S3-F11-T2, S3-F11-T3, S3-F11-T4.
- Relevant context: Skills, Plugins, Custom Agents, MCP tabs and provider dirs.

### S3-F11-T2 - Implement provider discovery adapters

- [x] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Provider-Scoped Extensions
- Outcome: Claude, Codex, Cursor, and OpenCode-backed sources produce one honest
  inventory without format conflation.
- Scope: Inventory installed provider paths and APIs; implement safe bounded
  scanners/adapters; normalize source IDs and metadata; watch/refresh changes;
  report parse and unsupported-version failures.
- Out of scope: Mutate providers that expose no supported write path.
- Acceptance:
  - Every supported provider fixture produces stable identities.
  - Unknown files/versions cannot become writable accidentally.
  - Refresh removes stale entries without deleting provider files.
- Verification: provider fixture tests and live inventory comparison.
- Estimated effort: 2-3 days.
- Blocked by: S3-F11-T1.
- Blocks: S3-F11-T3, S3-F11-T4.
- Relevant context: local provider configs, bundled harnesses, filesystem watchers.

### S3-F11-T3 - Rebuild extension Settings around provider scope

- [x] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Provider-Scoped Extensions
- Outcome: Users can filter by provider and see accurate identity, source,
  availability, read-only status, and limitations.
- Scope: Provider target/filter; badges; grouped inventory; empty/error states;
  deep links and search; duplicate-name handling; provider-neutral copy; hide
  mutation actions when unsupported.
- Out of scope: Runtime mutations implemented in S3-F11-T4.
- Acceptance:
  - Same-name entries show distinct provider/source context.
  - Read-only providers have no create/edit/delete action.
  - Search opens the exact provider-scoped entry.
- Verification: component/search/accessibility tests.
- Estimated effort: 1.5-2 days.
- Blocked by: S3-F11-T1, S3-F11-T2.
- Blocks: S3-F11-T5.
- Relevant context: existing two-panel tabs, Settings search/visibility registry.

### S3-F11-T4 - Wire supported extension mutations to provider runtimes

- [x] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Provider-Scoped Extensions
- Outcome: Enable/install/create/edit/delete actions affect the exact provider
  runtime or fail visibly without cross-provider corruption.
- Scope: Per-provider mutation adapters; atomic file/API writes; validation;
  rollback; runtime reload/restart semantics; plugin/custom-agent promotion gate;
  structured errors and audit metadata.
- Out of scope: Invent mutation support for read-only providers.
- Acceptance:
  - Mutating one identity cannot alter a same-name identity from another
    provider.
  - Failed validation/write leaves prior state intact.
  - Enabled/created item is consumed by a real provider run before promotion.
- Verification: fixture mutation/rollback tests and provider live smoke.
- Evidence: atomic provider-scoped mutation, rollback, frontmatter-preservation,
  bounded-discovery, and symlink-escape tests pass. Project-scoped items created
  through the adapter were consumed on 2026-07-13 by Claude Code 2.1.207
  (skill, command, and custom agent), Codex CLI 0.144.2 (skill), and Cursor Agent
  2026.07.09-a3815c0 (command) in read-only/no-tool runs. Each emitted its exact
  proof token; adapter deletion then removed every proof file and empty root.
- Estimated effort: 2-4 days.
- Blocked by: S3-F11-T1, S3-F11-T2.
- Blocks: S3-F11-T5.
- Relevant context: provider config formats, runtime reload paths, run manifests.

### S3-F11-T5 - Promote extension surfaces with provider evidence

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Provider-Scoped Extensions
- Outcome: Skills, Plugins, and Custom Agents expose only proven provider paths
  and carry an honest platform/provider matrix.
- Scope: Full/focused tests; verified dev inventory/mutations; run consumption;
  packaging paths; restore eligible hidden tabs/search entries; record deferred
  providers and read-only limitations.
- Out of scope: Require parity before shipping one honestly scoped provider.
- Acceptance:
  - Every visible write action has live runtime-consumption evidence.
  - Unsupported provider/kind combinations remain hidden or read-only.
  - Package contains required provider resources and discovers user-local items.
- Verification: full check, verified dev and package/provider matrix.
- Evidence: commit `b02055c56ac7a1c79fa49be49a2ba01730f66d5e`
  passes the Node 22 full gate (99 files, 724 passed, 3 skipped), both scoped
  strict OpenSpec validations, exact-checkout `npm run dev` plus
  `npm run dev:verify`, content-redacted inventory of 74 user-local items,
  create/update/delete through the production adapter for all five writable
  provider/kind paths, fail-closed OpenCode mutation, exact Codex/Cursor runtime
  tokens, cleanup, and macOS arm64 Preview build/launch/binary/resource smoke.
  The package ran from its exact bundle and Preview profile and its absent dev
  descriptor failed closed, preserving the product/dev MCP boundary.
- Remaining verification: the Mac was locked, so exercise inventory and
  mutations through the visible `Flapstack Dev` Settings UI and trigger
  user-local discovery through the packaged Settings surface. The integrated
  S3-F11-T4 evidence remains the current Claude skill/command/custom-agent
  consumption proof because new budget-bounded Claude attempts did not return a
  token. Windows/Linux package rows remain explicitly unavailable.
- Estimated effort: 1 day.
- Blocked by: S3-F11-T3, S3-F11-T4.
- Blocks: S3-F13-T1, S3-F13-T4.
- Relevant context: promotion registry, package resources, provider credentials.

## S3-F12 - Permission Mode Promotion

### S3-F12-T1 - Reconcile active permission ownership and eligibility matrix

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Permission Mode Promotion
- Outcome: The follow-on begins from the closed provider synchronization change
  and an evidence-backed provider/mode eligibility matrix.
- Scope: Finish or explicitly hand off GPP-T4/GPP-T6/GPP-T9/GPP-T10; verify current five-mode
  mappings; classify exact, conservative, best-effort, and unavailable controls;
  define global-default versus selected-chat eligibility.
- Out of scope: Change provider enforcement before matrix approval.
- Acceptance:
  - No duplicate task authority remains between active changes.
  - Every provider/mode cell names native controls and limitations.
  - Exact project boundary evidence is distinguished from cwd/classifier hints.
- Verification: strict spec review and existing provider permission suites.
- Estimated effort: 0.5-1 day after dependency closeout.
- Blocked by: S3-F7-T2 and `sync-provider-permissions-globally` GPP-T4, GPP-T6,
  GPP-T9, and GPP-T10.
- Blocks: S3-F12-T2, S3-F12-T3, S3-F12-T4.
- Relevant context: active permission proposal/design/tasks and provider adapters.

### S3-F12-T2 - Add durable custom defaults across the permission hierarchy

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Permission Mode Promotion
- Outcome: The existing exact per-chat custom schema gains coherent global,
  project, and task defaults without changing future-chat behavior accidentally.
- Scope: Versioned schema for project edits, shell, network, git, browser,
  secrets, subagents, third-party MCP, and product MCP tiers; durable
  global/project/task storage; copy-on-create resolution; immutable run snapshot;
  migration/defaults; atomic all-chat custom; Settings editor and previews.
- Out of scope: Mid-run permission mutation.
- Acceptance:
  - Every custom selection stores a complete schema version.
  - All-chat custom updates every default/chat atomically and future chats copy
    the same resolved toggles.
  - Run metadata captures resolved capabilities.
  - Missing/invalid fields fail to ask/deny defaults.
- Verification: schema/resolution/persistence/UI tests.
- Estimated effort: 1.5-2 days.
- Blocked by: S3-F12-T1, GPP-T10.
- Blocks: S3-F12-T3, S3-F12-T5.
- Relevant context: permission hierarchy, run snapshots, Settings Permissions.

### S3-F12-T3 - Enforce custom capabilities across providers

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Permission Mode Promotion
- Outcome: Claude, Codex, Cursor, OpenRouter, and NanoGPT consume each custom
  capability through native controls or conservative Flapstack approvals.
- Scope: Provider builders/bridges; unknown tool catch-all; network/external
  path handling; subagents; separate third-party/product MCP policy; preview and
  run metadata; fail-closed missing bridge behavior; one-prompt correlation.
- Out of scope: Claim exact native parity where Flapstack must ask/deny.
- Acceptance:
  - Full provider/capability matrix has allow/ask/deny tests.
  - Unknown tools cannot bypass a disabled capability.
  - Product Tier 0, product Tier 3, and third-party MCP remain distinct.
  - Preview matches captured runtime application.
- Verification: provider matrix, approval bridge, and run metadata tests.
- Estimated effort: 2-3 days.
- Blocked by: S3-F12-T1, S3-F12-T2, GPP-T9, S3-F3-T5.
- Blocks: S3-F12-T5.
- Relevant context: provider permission adapters and pending approval UI.

### S3-F12-T4 - Prove exact project-only eligibility per provider

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Permission Mode Promotion
- Outcome: `auto-edit-project-only` appears only where outside-project mutation
  is deterministically asked or denied.
- Scope: Canonical project/worktree boundary; symlink/relative path defense;
  provider native sandbox configuration; host callback enforcement where
  possible; Cursor capability decision; eligibility reporting and Settings/chat
  selectors.
- Out of scope: Label a best-effort classifier exact.
- Acceptance:
  - In-project edits auto-run for eligible providers.
  - Outside, symlink-escape, shell, and network attempts follow the specified
    ask/deny policy.
  - Ineligible providers do not offer the mode as a new choice.
- Verification: path-safety/provider matrix tests and low-risk live attempts.
- Estimated effort: 2-3 days.
- Blocked by: S3-F12-T1.
- Blocks: S3-F12-T5.
- Relevant context: project/worktree roots, provider sandboxes, path safety.

### S3-F12-T5 - Promote eligible permission modes and close the matrix

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Permission Mode Promotion
- Outcome: Custom and project-only choices return only for contexts with proven
  enforcement and clear limitations.
- Scope: Eligibility-aware option lists; custom editor; legacy-value migration
  choice; search/copy; full provider tests; verified dev permission changes and
  runs; package bridge verification.
- Out of scope: Automatically rewrite legacy user choices.
- Acceptance:
  - New selection availability matches provider eligibility.
  - Legacy values stay change-required until intentionally updated.
  - Custom/project-only runs record and enforce the shown contract.
- Verification: full permission suite/check, verified dev and provider matrix.
- Estimated effort: 1 day.
- Blocked by: S3-F12-T2, S3-F12-T3, S3-F12-T4.
- Blocks: S3-F13-T1, S3-F13-T4.
- Relevant context: permission Settings/chat selectors, previews and run records.

## S3-F13 - Copy and Search Consistency

### S3-F13-T1 - Audit and correct provider scope in visible copy

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Copy and Search Consistency
- Outcome: Visible settings use agent/provider language unless behavior is truly
  Claude-, Codex-, Cursor-, or OpenCode-specific.
- Scope: Preferences, Models/accounts, Voice, Skills, MCP, Plugins, Usage,
  Permissions, errors/toasts, and empty states; attach provider badges and
  limitations where needed; add copy fixtures for risky claims.
- Out of scope: Rename internal compatibility types solely for aesthetics.
- Acceptance:
  - Provider-neutral behavior has neutral copy.
  - Provider-specific behavior names the provider and limitation.
  - No visible copy claims exact permission/security behavior without evidence.
- Verification: copy/source contract tests and UI review.
- Estimated effort: 0.5-1 day.
- Blocked by: S3-F8-T4, S3-F9-T5, S3-F10-T4, S3-F11-T5, and S3-F12-T5.
- Blocks: S3-F13-T2.
- Relevant context: all visible Settings tabs and provider previews.

### S3-F13-T2 - Generate navigation and search from visibility metadata

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Copy and Search Consistency
- Outcome: Sidebar, direct routing, search, provider scope, and target anchors
  cannot drift into contradictory visibility.
- Scope: Expand typed visibility policy into registry; tab/control metadata;
  build/provider eligibility; search entries/keywords; content normalization;
  development-only policy; registry coverage assertions.
- Out of scope: Network or fuzzy search dependency.
- Acceptance:
  - Every visible tab/control has one registry identity and stable target.
  - Hidden controls produce no search result or route.
  - Search provider aliases only point to controls available for that provider.
- Verification: registry/search/navigation parity tests.
- Estimated effort: 0.5-1 day.
- Blocked by: S3-F7-T1 and S3-F13-T1.
- Blocks: S3-F13-T3.
- Relevant context: current settings visibility/search/sidebar/content files.

### S3-F13-T3 - Verify Settings discovery and accessibility

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Copy and Search Consistency
- Outcome: Keyboard and pointer users can discover every visible setting and no
  hidden setting leaks through search or focus.
- Scope: Search ranking/aliases; result context; focus/scroll/highlight;
  one-character behavior; Cmd/Ctrl+F; arrow/Enter/Escape; accessible labels;
  hidden/development/provider matrices.
- Out of scope: Transcript/project search.
- Acceptance:
  - Registry parity and keyboard navigation suites pass.
  - Verified dev search reaches every visible tab and representative control.
  - Hidden/development/provider-ineligible queries return no leaked target.
- Verification: Settings search/UI tests and verified dev accessibility smoke.
- Estimated effort: 0.5 day.
- Blocked by: S3-F13-T2.
- Blocks: S3-F13-T4.
- Relevant context: Settings search input/result list/content focus handling.

### S3-F13-T4 - Run the Settings Hardening release gate

- [ ] Completion: acceptance and verification passed
- Parent: Flapstack / S3 Safe Agent Control / Copy and Search Consistency
- Outcome: Only evidence-backed Settings features are visible, and remaining
  gaps are recorded without optimistic completion.
- Scope: Strict OpenSpec validation; Node 22 full check; verified dev profile;
  navigation/search matrix; migration fixtures; provider/credential/voice
  package checks; platform evidence; update task truth and archive when done.
- Out of scope: Mark unavailable credential/platform checks passed.
- Acceptance:
  - OpenSpec strict validation and full gate pass.
  - Visible registry equals tested/passed promotion set.
  - Each native/provider feature has required live/package evidence or remains
    hidden with an unchecked task.
  - Rollback and recovery paths are documented and exercised proportionally.
- Verification: all task-specific evidence plus final release checklist.
- Estimated effort: 1-2 days after feature work.
- Blocked by: S3-F7-T4, S3-F8-T4, S3-F9-T5, S3-F10-T4, S3-F11-T5,
  S3-F12-T5, and S3-F13-T3.
- Blocks: archive `complete-settings-reliability`.
- Relevant context: this task board, stage routers, root live-dev/package rules.

# Global Provider Permission Tasks

This is the sole task checklist for the change.

### GPP-T1 - Add atomic permission behavior and synchronization service

- [x] Completion: acceptance and verification passed
- Parent: Flapstack / Provider permissions / Global permission synchronization
- Outcome: One backend operation applies a selected permission mode to an
  explicit scope without leaving conflicting stored values, while a separate
  preference records whether the UI should ask or reuse a prior scope.
- Scope: Persist `ask | all-chats | current-chat`; default missing values to
  `ask`; accept an explicit mutation scope; update
  global/project/task/chat/internal-conversation values for non-custom all-chat changes;
  preserve archived chats, historical runs, and in-flight runs; restore the
  prior file config on database failure.
- Out of scope: New database columns, all-chat custom toggles, and historical run rewrites.
- Acceptance:
  - A fresh or invalid config resolves change behavior to `ask`.
  - All-chat updates change every active and archived default/conversation row.
  - Current-chat updates change only the selected chat and its internal
    conversation rows.
  - Historical and currently running `agent_runs` retain their captured mode.
  - Partial failures do not report success or leave silently divergent state.
- Verification: focused permission service/router tests under Node 22.
- Blocked by: none
- Blocks: GPP-T2, GPP-T5, GPP-T7, GPP-T10
- Relevant context: `src/main/lib/permissions.ts`, permission tRPC router,
  SQLite project/task/chat/sub-chat tables.

### GPP-T2 - Confirm permission scope and optionally remember it

- [x] Completion: acceptance and verification passed
- Parent: Flapstack / Provider permissions / Global permission synchronization
- Outcome: A chat permission change is not persisted until the user chooses one
  chat or all chats, unless a remembered behavior intentionally skips the popup.
- Scope: Add pending selection state and the confirmation modal; preselect all
  chats; keep remember unchecked; persist a checked choice; support cancel;
  display stronger all-chat/full-access copy; call the explicit scoped mutation;
  invalidate all affected permission/chat queries; show success/error feedback.
- Out of scope: Per-chat management inside Settings (GPP-T7).
- Acceptance:
  - A fresh profile opens the popup and preselects `All chats`.
  - No mutation occurs until Apply; Cancel restores the selector and changes no
    stored value.
  - Checking remember stores the chosen behavior and skips later popups.
  - Leaving remember unchecked causes the next change to ask again.
  - All-chat full access is visibly identified before and after mutation.
  - Successful current/all-chat mutations refresh every affected Settings,
    input-bar, active/archive chat, project, and task query.
- Verification: renderer dialog/state tests plus manual dev-app interaction.
- Blocked by: GPP-T1
- Blocks: GPP-T6
- Relevant context: chat input permission dropdown, Permissions Settings tab,
  React Query tRPC invalidation.

### GPP-T3 - Harden Claude, Cursor, and OpenCode permission mappings

- [x] Completion: acceptance and verification passed
- Parent: Flapstack / Provider permissions / Closest provider mapping
- Outcome: Every non-Codex provider receives the closest conservative native
  mapping and reports exact limitations.
- Scope: Make Claude MCP/read-only handling conservative; keep Claude SDK mode
  mapping explicit; verify Cursor plan/sandbox/auto-review/force flags; add
  OpenCode catch-all rules for unknown and MCP tools; share OpenCode mappings
  across OpenRouter and NanoGPT.
- Out of scope: Completing fine-grained custom toggles.
- Acceptance:
  - The full five-mode matrix is covered for Claude, Cursor, OpenRouter, and
    NanoGPT.
  - Unknown/MCP OpenCode tools cannot bypass read-only or ask modes through
    permissive defaults.
  - Unsupported exact controls produce limitations and never claim full
    enforcement.
- Verification: provider permission matrix tests under Node 22.
- Blocked by: none
- Blocks: GPP-T5, GPP-T9
- Relevant context: shared permission builders, Cursor args, Claude
  `canUseTool`, OpenCode session permission builder and approval bridge.

### GPP-T4 - Apply Codex ACP modes and add a fail-closed approval bridge

- [x] Completion: acceptance and verification passed
- Parent: Flapstack / Provider permissions / Closest provider mapping
- Outcome: Codex runs use the selected ACP mode, and unanswered permission
  requests can never be auto-approved.
- Scope: Map Flapstack modes to Codex ACP mode IDs; pass the mode to the ACP
  language model/session; add a packaging-safe permission callback boundary;
  route ask/escalation requests to pending approval UI; reject read-only,
  timeout, cancellation, disconnect, missing-handler, and unknown-option cases.
- Out of scope: Replacing the entire Codex transport.
- Acceptance:
  - `read-only`, workspace `agent`, and `agent-full-access` are selected exactly
    where defined by the design matrix.
  - No code path defaults to `options[0]` for a Codex permission request.
  - Ask mode can approve or reject once through Flapstack.
  - Read-only and missing-bridge cases fail closed.
  - The callback remains present after install and in packaged output.
- Verification: Codex mode/approval unit tests, install-patch verification, and
  one low-risk live Codex permission smoke under the verified dev profile.
- 2026-07-13 closeout: installed/provider-package patching now treats a stale or
  archived ACP session as recoverable and starts a fresh session; focused bridge
  tests pass. The macOS Preview package contains both patched provider bundles
  and the Codex product-MCP identity patch. `Flapstack Dev` and Codex login were
  verified, but the Mac was locked before a fresh Codex permission request could
  be exercised. Live smoke remains open.
- 2026-07-13 `609c` continuation: authenticated Dev MCP launched real Codex ACP
  ask-mode runs and resolved one redacted request with reject-once and one with
  allow-once. The original workspace agent exposed `/tmp`; the installed patch
  now excludes `TMPDIR` and `/tmp`. A fresh project-only run auto-wrote inside
  the checkout, asked for `/tmp`, rejected once, left the outside marker absent,
  and completed successfully. Object-shaped rejected tool output is reduced to
  a generic message and no raw provider payload is returned. Installed and
  packaged patch assertions pass.
- Blocked by: none
- Blocks: GPP-T6, GPP-T9
- Relevant context: Codex ACP provider lifecycle, `@mcpc-tech/acp-ai-provider`,
  installed `@agentclientprotocol/codex-acp` mode definitions, existing Claude
  and OpenCode pending-approval patterns.

### GPP-T5 - Expand provider previews and regression coverage

- [x] Completion: acceptance and verification passed
- Parent: Flapstack / Provider permissions / Verification
- Outcome: Pre-run UI and automated tests expose the effective native mapping
  for every provider.
- Scope: Extend preview input/output to all supported harnesses; render
  provider-specific warnings; add global/current scope, archived-row,
  historical-run, mapping-matrix, unknown-tool, and fail-closed regression
  tests.
- Out of scope: Provider billing or account setup.
- Acceptance:
  - Every provider returns a preview for every Flapstack permission mode.
  - Degradation text names the real missing control.
  - Tests fail if a mapping becomes more permissive or a sync layer is skipped.
- Verification: focused tests, `npm run lint`, `npm run style:check`, and
  `npm run ts:check` under Node 22.
- Blocked by: GPP-T1, GPP-T3
- Blocks: GPP-T6
- Relevant context: `HarnessPermissionApplication`, permissions preview tRPC,
  input-bar warning popover, `tests/permissions.test.ts`, provider tests.

### GPP-T7 - Add the Permissions settings center

- [x] Completion: acceptance and verification passed
- Parent: Flapstack / Provider permissions / Permission management
- Outcome: Users can clear remembered behavior, choose the future-chat default,
  and intentionally maintain different permissions across chats from one page.
- Scope: Add a top-level Permissions Settings tab; move the global default into
  it; expose `Ask every time | Always all chats | Always this chat`; list active
  and archived chats with project/task context and stored mode; filter that list
  by chat/project/task text; add direct per-chat selectors that always use
  current-chat scope; invalidate affected queries and report failures.
- Out of scope: New database columns, historical run editing, project/task
  default editors, or bulk deletion.
- Acceptance:
  - The page shows the effective future-chat default and remembered behavior.
  - Selecting `Ask every time` clears a remembered scope.
  - Active and archived chats can be filtered by chat, project, or task text and
    their stored modes inspected.
  - Editing one listed chat changes only that chat and its internal conversation
    rows, regardless of remembered chat-selector behavior.
  - The future-chat default can change without rewriting existing chats.
- Verification: permission Settings component tests plus focused router/service
  tests under Node 22.
- Blocked by: GPP-T1
- Blocks: GPP-T6, GPP-T8
- Relevant context: Settings tab registry/content switch, Preferences default
  permission row, chats active/archive queries, permission router/service.

### GPP-T8 - Add live keyword search to Settings

- [x] Completion: acceptance and verification passed
- Parent: Flapstack / Settings / Navigation and discovery
- Outcome: Every visible Settings page and major control is discoverable from
  the first typed character and opens at the relevant control.
- Scope: Add the sidebar search input; create a typed static index of tab,
  control, description, keyword, and anchor metadata; implement normalized
  all-token matching and deterministic ranking; update on every keystroke with
  no debounce or minimum length; show result labels/tab context; add
  arrow/Enter navigation, `Cmd/Ctrl+F`, clear-first Escape, target scroll/focus,
  and temporary highlight; gate development-only entries with visibility.
- Out of scope: Network search, transcript/project search, typo-distance
  algorithms, or a new search dependency.
- Acceptance:
  - One-character queries immediately produce matching visible results.
  - Label, description, and keyword aliases all match case- and
    punctuation-insensitively.
  - Exact and prefix matches rank ahead of description-only substrings.
  - Choosing a result opens the correct tab and targets the control.
  - `permission`, `access`, `approval`, `read only`, `all chats`, and `default`
    surface the relevant Permissions controls.
  - Hidden development controls do not leak into production results.
- Verification: pure search-ranking tests, Settings keyboard/navigation tests,
  and manual character-by-character search in the verified dev profile.
- Blocked by: GPP-T7
- Blocks: GPP-T6
- Relevant context: `settings-sidebar.tsx`, `settings-content.tsx`, SettingsTab
  atom, new Permissions tab anchors, visible development-tab gate.

### GPP-T9 - Integrate provider permission mapping with product MCP approval

- [x] Completion: acceptance and verification passed
- Parent: Flapstack / Provider permissions / Product MCP integration
- Outcome: Provider-native tool authority and Stage 3 product MCP tiers combine
  without authorizing third-party MCP, double prompting, or bypassing Tier 3.
- Scope: Identify product-registry calls at the provider bridge; allow only Tier
  0 product reads in read-only mode; correlate ask-mode requests to one product
  approval; pass Tier 3 through the mandatory Stage 3 decision; fail closed for
  unknown or uncorrelated MCP tools.
- Out of scope: Product registry tiers, audit storage, and approval UI, which are
  owned by `add-stage3-mcp-control` S3-F3/S3-F6.
- Acceptance:
  - Read-only permits product Tier 0 and denies third-party MCP/product writes.
  - Ask mode emits one approval for one invocation.
  - Provider allow cannot skip product Tier 3 approval.
  - Provider/product denial and bridge failure never widen access.
- Verification: `tests/mcp-provider-permission-integration.test.ts`.
- 2026-07-13 closeout: the named provider/product matrix passes, including
  separate product/third-party capabilities, no-double-prompt, fail-closed, and
  mandatory Tier 3 cases. The fresh GPP-T4 Codex approval/boundary proof closes
  the remaining live dependency without widening Tier 3 or third-party MCP.
- Blocked by: GPP-T3, GPP-T4, S3-F3-T5
- Blocks: GPP-T6, S3-F12-T3
- Relevant context: provider permission builders/bridges, product registry tier,
  approval invocation correlation.

### GPP-T10 - Enforce exact scoped custom-permission persistence

- [x] Completion: acceptance and verification passed
- Parent: Flapstack / Provider permissions / Scoped permission synchronization
- Outcome: Per-chat custom toggles are exact and durable without creating false
  hierarchy-wide custom defaults.
- Scope: Require a complete validated toggle object for current-chat custom;
  persist it only on the selected chat; clear custom JSON when moving away from
  custom; reject all-chat custom until S3-F12 adds durable global/project/task
  custom defaults; keep non-custom all-chat sync atomic and clear stale chat JSON.
- Out of scope: Add the durable custom default hierarchy or provider enforcement
  matrix owned by S3-F12.
- Acceptance:
  - Current-chat custom round-trips exact toggles across restart.
  - Missing, partial, malformed, or extra-key toggles fail closed.
  - Non-custom selection clears prior custom JSON.
  - All-chat custom changes nothing and explains the S3-F12 prerequisite.
- Verification: `tests/mcp-custom-permissions-persistence.test.ts` and scoped
  permission router/service tests.
- Blocked by: GPP-T1
- Blocks: GPP-T6, S3-F12-T2
- Relevant context: `chats.custom_permissions`, permission router, custom schema,
  S3-F12 durable-default design.
- 2026-07-13 ownership note: S3-F12 now owns and implements versioned durable
  hierarchy defaults plus atomic all-chat custom. The earlier fail-closed
  all-chat rejection remains valid only for pre-promotion builds.

### GPP-T6 - Run full and live verification

- [x] Completion: acceptance and verification passed
- Parent: Flapstack / Provider permissions / Verification
- Outcome: The feature is code-ready and its live behavior is proven in the
  correct Flapstack Dev profile.
- Scope: Strict OpenSpec validation; full Node 22 `npm run check`; guarded dev
  launch/reload; `npm run dev:verify`; exercise all-chat and current-chat UI;
  perform available low-risk provider smokes; record unavailable credential or
  platform evidence honestly.
- Out of scope: Creating or purchasing provider credentials.
- Acceptance:
  - Strict OpenSpec and full commit gate pass.
  - Dev verification identifies this checkout and `Flapstack Dev`.
  - One chat permission change asks with `All chats` preselected, then visibly
    updates all chats after confirmation.
  - Remembered scope, reset-to-ask, direct per-chat management, and Settings
    search all work in the live Settings view.
  - A subsequent run records the selected mode and effective provider mapping.
  - Missing provider credentials are reported as manual verification remaining,
    not fabricated as passed.
- Verification: strict OpenSpec validation, Node 22 `npm run check`,
  `npm run dev:verify`, and the documented manual matrix.
- 2026-07-13 closeout: `npm run dev:verify` passed for this checkout and
  `Flapstack Dev` on Node 22. Fresh OpenRouter and NanoGPT runs succeeded through
  dev-test-control and both test chats were archived. The live all-chat Apply
  was not run against the existing 312-chat profile; atomic all-chat behavior is
  covered by isolated router/service tests. The Mac lock blocks visual Settings
  rows and the fresh Codex smoke in GPP-T4. Full Node 22 `npm run check` passed
  with 730 tests passed and 3 skipped; macOS Preview packaging passed unsigned.
- 2026-07-13 `609c` continuation: authenticated MCP drove all-chat and current-
  chat permission UI state, remembered/reset behavior, exact reviewed custom
  capabilities, archived-chat propagation, Settings search, run metadata, and
  live Codex approve/reject/project-boundary smokes. Shared-lease accessibility
  proved the real dialog, scope copy, selector state, and legacy change-required
  label. The exact Dev passed `npm run dev:verify`; the rebuilt unsigned Preview
  launched with the same production renderer bridge. Unavailable paid-provider
  and cross-platform rows remain explicitly unclaimed.
- Blocked by: GPP-T2, GPP-T4, GPP-T5, GPP-T7, GPP-T8, GPP-T9, GPP-T10
- Blocks: none
- Relevant context: root `AGENTS.md` live-dev rules, run metadata, provider
  authentication state, manual evidence conventions.

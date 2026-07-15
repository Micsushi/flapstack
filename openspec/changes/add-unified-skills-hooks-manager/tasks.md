# S4-F1 — Unified Skills and Hooks Manager

### S4-F1-T1 — Reconcile the Stage 3 extension baseline

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F1
- Outcome: One tested capability registry describes every currently supported extension surface.
- Scope: Inventory skills, commands, plugins, custom agents, MCP entries, and hooks; record harness, scope, mutation, and runtime-consumption support.
- Out of scope: New extension formats.
- Acceptance: Registry matches current routers and provider behavior; unsupported combinations remain explicit.
- Verification: Focused registry tests and fixture comparison for shipped harness versions.
- Blocked by: Stage 3 S3-F11 and S3-F13 exit
- Blocks: S4-F1-T2, S4-F1-T4, S4-F1-T5
- Context: `skills.ts`, `commands.ts`, `plugins.ts`, `hooks-management.ts`, Settings extension tabs.
- Code-ready evidence: the production `providerExtensions.getCapabilities` query
  now returns a schema-versioned 72-cell registry across four harnesses, six
  extension kinds, and three scopes, including 36 explicit unsupported cells.
  Focused fixture/provider-DTO/hook/router coverage passes 40 tests against
  Claude Agent SDK 0.3.207 / Claude Code 2.1.207, Codex ACP 1.1.2 / CLI 0.144.1,
  Cursor Agent 2026.07.09-a3815c0, and OpenCode 1.17.18. Exact additive gaps and
  their downstream owners are recorded in
  `docs/stage4-s4-f1-t1-extension-baseline.md`. The immutable `stage3-final` tag
  resolves to `a674784b0141c7a5293c5637c3bea65be6d44c4e`; its archived board checks
  S3-F11-T5 and S3-F13-T4, and its release ledger records all required feature
  exits complete. T1 therefore closes on its declared headless verification.
  No live/package/provider/device or later-F1 acceptance proof is inferred.

### S4-F1-T2 — Add safe native extension adapters

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F1
- Outcome: Native extension files can be read and changed without escaping allowed roots or losing data.
- Scope: Provider adapters, schema parsing, unknown-field retention, atomic writes, backup/restore, symlink and traversal defense.
- Out of scope: Cross-harness conversion.
- Acceptance: Round-trip fixtures are lossless; invalid or escaped paths fail before write.
- Verification: Adapter round-trip, malformed-file, symlink, traversal, and rollback tests.
- Blocked by: S4-F1-T1
- Blocks: S4-F1-T3, S4-F1-T4, S4-F1-T6
- Context: registered worktree validation and current filesystem routers.
- Code-ready evidence: a schema-versioned native Markdown adapter registry now
  covers every non-MCP mutable capability row for Claude Code, Codex, and Cursor
  Agent across six pinned native formats and all eleven mutable user/project
  rows. Production read/preview/apply/restore procedures retain unknown fields,
  bind applies to exact before/after/confirmation hashes, use rooted atomic
  writes plus strict target-bound backups, and reject malformed, stale,
  traversed, or symlinked targets. Node 22 focused adapter/capability/provider/
  path/cross-harness/UI suites pass 99 tests; TypeScript, focused ESLint,
  focused Prettier, strict OpenSpec, git diff check, and the production build
  pass. The authoritative integration board closes T1; this lane does not mirror
  that adjacent checkbox. T2 closes on its declared headless verification. No
  live/package/provider/device or later-F1 acceptance proof is inferred; see
  `docs/stage4-s4-f1-t2-native-adapters.md`.

### S4-F1-T3 — Add project and task enablement policy

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F1
- Outcome: Runs resolve extension policy from user default through project and task scope.
- Scope: Additive policy storage, resolver, resolved-state API, run-context integration, and restart migration.
- Out of scope: Editing extension content.
- Acceptance: Task overrides project; project overrides user; unsupported scopes never write fake state.
- Verification: Migration, resolver precedence, restart, and supported-harness run-context tests.
- Blocked by: S4-F1-T2
- Blocks: S4-F1-T5, S4-F1-T7, S4-F8-T1, S4-F12-T3
- Context: permission inheritance and run-context assembly patterns.
- Code-ready evidence: migration `0030_extension_enablement_policy` adds only
  additive SQLite policy state after `0029`; the resolver enforces task over
  project over user over fixed-enabled precedence and rejects unsupported
  capability/scope writes. Production resolved-state/set/clear APIs and Claude,
  Codex, and Cursor run-context integration are present. Disabled Claude skills
  and MCP plus Codex skills and MCP now use provider launch contracts; Claude
  commands/custom agents and Cursor commands fail closed before launch because
  their pinned harnesses expose no per-extension discovery filter. Node 22
  focused tests pass 13 migration, precedence, restart, unsupported-scope,
  adversarial collision, launch-filter, and router-order cases. Completion
  remains unchecked pending live provider behavior plus Dev-profile and packaged
  restart proof; no provider-native extension content was edited. See
  `docs/stage4-s4-f1-t3-extension-policy.md`.

### S4-F1-T4 — Add explicit cross-harness copy and sharing

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F1
- Outcome: Users copy supported extensions between harnesses with an exact preview.
- Scope: Conversion adapters, exact/converted/unsupported result, target diff, collision handling, and source preservation.
- Out of scope: Live synchronization between files.
- Acceptance: No write occurs before preview confirmation; unsupported fields are never silently dropped.
- Verification: Bidirectional fixture tests, collisions, cancel, unsupported-field, and rollback tests.
- Blocked by: S4-F1-T1, S4-F1-T2
- Blocks: S4-F1-T5, S4-F1-T7
- Context: native adapter DTOs and Settings dialogs.
- Code-ready evidence: a schema-versioned cross-harness copy service now returns
  exact, converted, or unsupported previews with explicit source/target
  capability rows, stateless cancellation, collision policy, exact target diff,
  stale-preview confirmation hashes, and native-adapter rollback. Portable
  manifests omit host paths/runtime state, reject unsafe data, and never export
  unsupported source fields; target-only unknown native fields survive
  overwrites. Node 22 focused copy/native/capability/provider/path suites pass 58
  tests; focused and repository ESLint, repository formatting, and strict
  OpenSpec pass. Full TypeScript reached only two unrelated pre-existing Codex
  ACP provider-setting errors. At that checkpoint, completion remained unchecked
  because declared T1 and T2 dependencies were still open; see
  `docs/stage4-s4-f1-t4-cross-harness-sharing.md`.
- Integrated closeout: T1 and T2 are complete. Node 22 cross-harness copy, native adapter, capability registry, provider service, and provider UI suites pass 5 files/70 tests; integrated TypeScript, lint, formatting, strict OpenSpec, diff check, and production build pass. T4 closes on its declared headless verification without inferring live provider/package evidence.

### S4-F1-T5 — Build the unified manager UI

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F1
- Outcome: One Settings surface filters and manages extensions by harness, kind, source, and scope.
- Scope: Inventory, support badges, source paths, resolved policy, create/edit/copy/disable flows, search, keyboard and screen-reader behavior.
- Out of scope: Marketplace browsing.
- Acceptance: Every action exposes harness, scope, path, support state, and resulting diff; no hidden destructive action.
- Verification: Component/accessibility tests and live user/project/task walkthrough.
- Blocked by: S4-F1-T1, S4-F1-T3, S4-F1-T4
- Blocks: S4-F1-T7
- Context: existing Agents Skills/Plugins/MCP tabs and Settings search registry.
- Code-ready evidence: the shared Settings extension manager now consumes the
  capability registry, native adapter previews, resolved user/project/task
  policy, cross-harness copy previews, and managed-hook inventory/preview APIs.
  Harness, kind, source, scope, and normalized search selectors; exact
  preview/diff confirmations; honest unsupported states; and keyboard/screen-
  reader contracts are covered headlessly. Managed hooks now complete the same
  preview-confirmed validation, bounded dry-run, enable, and disable lifecycle,
  with current-revision and Tier 3 approval gates visible in the UI. A verified
  Dev-profile walkthrough now proves that a stale selected-project root retains
  user inventory while project mutation fails closed, and that a registered
  project enables an exact, review-gated policy preview; the preview was
  cancelled without mutation. Completion remains unchecked because applied
  user/project/task mutation, Dev restart/runtime proof, screen-reader
  observation, and packaged UI evidence remain manual verification remaining;
  see `docs/stage4-s4-f1-t5-unified-manager.md`.

### S4-F1-T6 — Add hook validation, dry-run, and enablement

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F1
- Outcome: Supported hooks can be inspected and tested without silent execution.
- Scope: Hook inventory, schema validation, exact command preview, bounded dry-run, explicit enable/disable, import-default-off, audit redaction.
- Out of scope: Background scheduler triggers.
- Acceptance: A hook cannot enable before validation and dry-run; imported hooks remain disabled; secrets do not enter logs.
- Verification: State-machine, command-injection, timeout, redaction, import, and live enable/disable tests.
- Blocked by: S4-F1-T2 and Stage 3 approval/audit gate
- Blocks: S4-F1-T7
- Context: `hooks-management.ts`, MCP gate/audit patterns, provider hook files.
- Code-ready evidence: the production hook router now exposes a schema-versioned
  managed inventory, exact shell-free command preview, import-default-off
  lifecycle, registered-root revalidation, bounded mockable dry-run, explicit
  enable/disable state, Tier 3 Stage 3 approval, append-only redacted audit, and
  one unified lifecycle UI. Node 22 consolidated F1 coverage passes 11 files / 144
  tests; TypeScript and focused ESLint pass. Completion remains unchecked because live
  Settings/restart/package evidence and native harness runtime consumption are
  unverified; see `docs/stage4-s4-f1-t6-hook-safety.md`.

### S4-F1-T7 — Close unified extension acceptance

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F1
- Outcome: Supported extension management works after restart in Dev and packaged preview.
- Scope: Run focused tests, Node 22 full gate, matrix S4-SH01 through S4-SH04, docs, and limitation review.
- Out of scope: Unsupported provider parity.
- Acceptance: One user and one project extension are exercised per supported harness; hook safety rows pass; limitations are visible.
- Verification: `npm run check`, strict OpenSpec, `npm run dev:verify`, and packaged preview matrix evidence.
- Blocked by: S4-F1-T3, S4-F1-T4, S4-F1-T5, S4-F1-T6
- Blocks: Stage S4 integrated exit
- Context: `docs/stage4-full-feature-test-matrix.md`.

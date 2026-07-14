# S4-F1 — Unified Skills and Hooks Manager

### S4-F1-T1 — Reconcile the Stage 3 extension baseline

- [ ] Completion: acceptance and verification passed
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
  Focused fixture/provider-DTO/hook/router coverage passes 21 tests against
  Claude Agent SDK 0.3.207 / Claude Code 2.1.207, Codex ACP 1.1.2 / CLI 0.144.1,
  Cursor Agent 2026.07.09-a3815c0, and OpenCode 1.17.18. Exact additive gaps and
  their downstream owners are recorded in
  `docs/stage4-s4-f1-t1-extension-baseline.md`. Completion stays unchecked
  because the declared Stage 3 S3-F11/S3-F13 exit/archive and live/package proof
  remain open; none of that evidence is inferred from headless tests.

### S4-F1-T2 — Add safe native extension adapters

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F1
- Outcome: Native extension files can be read and changed without escaping allowed roots or losing data.
- Scope: Provider adapters, schema parsing, unknown-field retention, atomic writes, backup/restore, symlink and traversal defense.
- Out of scope: Cross-harness conversion.
- Acceptance: Round-trip fixtures are lossless; invalid or escaped paths fail before write.
- Verification: Adapter round-trip, malformed-file, symlink, traversal, and rollback tests.
- Blocked by: S4-F1-T1
- Blocks: S4-F1-T3, S4-F1-T4, S4-F1-T6
- Context: registered worktree validation and current filesystem routers.

### S4-F1-T3 — Add project and task enablement policy

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F1
- Outcome: Runs resolve extension policy from user default through project and task scope.
- Scope: Additive policy storage, resolver, resolved-state API, run-context integration, and restart migration.
- Out of scope: Editing extension content.
- Acceptance: Task overrides project; project overrides user; unsupported scopes never write fake state.
- Verification: Migration, resolver precedence, restart, and supported-harness run-context tests.
- Blocked by: S4-F1-T2
- Blocks: S4-F1-T5, S4-F1-T7, S4-F8-T1
- Context: permission inheritance and run-context assembly patterns.

### S4-F1-T4 — Add explicit cross-harness copy and sharing

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F1
- Outcome: Users copy supported extensions between harnesses with an exact preview.
- Scope: Conversion adapters, exact/converted/unsupported result, target diff, collision handling, and source preservation.
- Out of scope: Live synchronization between files.
- Acceptance: No write occurs before preview confirmation; unsupported fields are never silently dropped.
- Verification: Bidirectional fixture tests, collisions, cancel, unsupported-field, and rollback tests.
- Blocked by: S4-F1-T1, S4-F1-T2
- Blocks: S4-F1-T5, S4-F1-T7
- Context: native adapter DTOs and Settings dialogs.

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

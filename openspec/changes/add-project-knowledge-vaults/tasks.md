# S4-F2 — Project Knowledge Vaults

### S4-F2-T1 — Implement and persist the vault location policy

- Evidence class: `T2-core`.
- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F2
- Outcome: Every project has an explicit, inspectable vault location and tracking policy.
- Scope: Implement app-managed central storage as the default; add explicit project-owned and git-tracking opt-ins; persist portability, worktree, and deletion semantics.
- Out of scope: Creating vault content.
- Acceptance: Default setup uses stable central storage; project-owned paths and tracking activate only after explicit opt-in; selected paths remain stable across restart and worktree changes.
- Verification: Policy resolver, migration, missing-root, restart, and worktree fixture tests.
- Blocked by: none
- Blocks: S4-F2-T2, S4-F2-T6
- Context: disabled scaffold reason in `project-vaults.ts`; project/worktree schema.

### S4-F2-T2 — Implement typed vault storage and scaffold

- Evidence class: `T2-core`.
- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F2
- Outcome: Approved projects create and maintain typed Markdown knowledge safely.
- Scope: Additive metadata, section registry, scaffold, atomic read/write, versioning, backups, root/symlink checks, and delete confirmation.
- Out of scope: UI and run injection.
- Acceptance: Only approved sections are created; escaped paths and stale versions fail closed; content survives restart.
- Verification: Migration, scaffold, path attack, concurrency, backup, and rollback tests.
- Evidence (2026-07-13): 37 focused headless DB/filesystem/security/migration tests passed across `project-vault-storage`, `project-vault-policy`, `path-safety`, `registered-root-identity`, `stage3-migration-rebase`, and `plan-kanban-schema`; TypeScript, focused ESLint/Prettier, strict OpenSpec, and `git diff --check` passed.
- Blocked by: S4-F2-T1
- Blocks: S4-F2-T3, S4-F2-T4, S4-F2-T5, S4-F8-T1
- Context: `project-vaults.ts`, path safety, project and attachment storage patterns.

### S4-F2-T3 — Add vault browser, editor, and search

- Evidence class: `T2-core`.
- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F2
- Outcome: Users can inspect and edit project knowledge with honest conflicts.
- Scope: Project entry, section tree, Markdown viewer/editor, scoped search, change indicators, conflict diff, restore, keyboard/accessibility behavior.
- Out of scope: Full Obsidian plugin or graph support.
- Acceptance: Search stays inside the selected vault; stale saves preserve both versions; secrets never appear in snippets.
- Verification: Component/accessibility, search-scope, stale-save, redaction, and live edit tests.
- Evidence (2026-07-14): Tier 1 code-ready/Tier 2
  live-verification-remaining. Added the
  project entry, typed accessible section tree, Markdown preview/editor,
  project-only redacted search, dirty/external indicators, optimistic conflict
  diff and explicit resolution, and verified backup preview/restore services.
  Headless service/reducer coverage, Node 22 TypeScript, focused ESLint/Prettier,
  strict OpenSpec, and `git diff --check` pass. Renderer component/accessibility
  and live edit proof remain unrun under the lane restriction, so completion
  stays unchecked.
- Evidence (2026-07-15): Code/headless acceptance expanded. Added explicit,
  accessible project-default run-context selection; exact-content CAS at the
  atomic replace boundary; ownership-conditional rollback; secret-safe section
  and backup previews; and malformed-secret search fail-closed behavior. The
  feature-wide Node 22 slice passes 14 files/120 tests, including renderer
  component/keyboard/accessibility coverage. Repository ESLint, scoped
  Prettier, full TypeScript, strict OpenSpec, and diff hygiene pass. Live visual,
  interactive editor, multi-window, and packaged-profile proof remains open, so
  completion stays unchecked.
- Blocked by: S4-F2-T2
- Blocks: S4-F2-T6
- Context: file viewer, scoped search, diff components, project details surfaces.

### S4-F2-T4 — Add explicit run-context loading

- Evidence class: `T2-core`.
- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F2
- Outcome: Selected vault sections enter agent context with provenance and budgets.
- Scope: Project/task/run selection, default policy, size/token budget, truncation report, context manifest, supported harness integration.
- Out of scope: Hidden automatic memory selection.
- Acceptance: Only selected sections load; every inclusion and truncation is visible; oversized or unsafe content fails honestly.
- Verification: Resolver, budget, provenance, secret-rejection, and per-harness context tests.
- Evidence (2026-07-13): 84 focused headless tests passed across run-context,
  vault storage/policy, plan source/schema, Stage 3 migration, MCP launch, and
  Codex/Claude harness paths; Node 22 TypeScript, focused ESLint/Prettier,
  strict vault and Plan/Kanban OpenSpec validation, and `git diff --check` passed.
- Blocked by: S4-F2-T2
- Blocks: S4-F2-T5, S4-F2-T6
- Context: agent context/evidence pipeline and run manifests.

### S4-F2-T5 — Add approved agent vault operations

- Evidence class: `T2-core`.
- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F2
- Outcome: Authorized agents read and update vault sections through bounded tools.
- Scope: MCP list/read/create/update tools, version preconditions, approval tiers, audit redaction, invalidation, handoff/decision helper operations.
- Out of scope: Secret storage and arbitrary filesystem access.
- Acceptance: Reads honor caller scope; writes require exact section/version and applicable approval; stale/secret writes fail closed.
- Verification: Registry, caller identity, approval, audit, stale-write, secret, and renderer invalidation tests.
- Evidence (2026-07-14): Added bounded MCP list/read/create/update, handoff,
  and decision tools over the typed vault registry. Exact project/section/version
  inputs, durable caller scope, Stage 3 Tier 0/Tier 2 gates, project-write
  capability enforcement, redacted audit summaries, secret and external-change
  rejection, registered-root storage, and vault query invalidation are covered by
  74 focused headless tests across registry transport, caller reads, approval,
  audit, stale/secret storage, and invalidation. Focused ESLint/Prettier, strict
  OpenSpec, and `git diff --check` passed. Full TypeScript reached only the three
  pre-existing `local-model-catalog.ts` unknown-value errors; changed files add
  no TypeScript errors. Manual/live/UI/package and Stage 3 release verification
  remain unrun under this lane restriction and are non-blocking for this code task.
- Blocked by: S4-F2-T2, S4-F2-T4 and Stage 3 MCP gate/audit
- Blocks: S4-F2-T6
- Context: app-control MCP registry, gate, audit, and invalidation bridge.

### S4-F2-T6 — Close vault acceptance and recovery

- Evidence class: `T2-core`.
- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F2
- Outcome: Vault setup, use, export, and restore pass in verified Dev and an
  isolated fresh profile.
- Scope: Export/import bundle, schema version, conflict preview, backup restore, full gate, matrix S4-KV01 through S4-KV05, docs and limitations.
- Out of scope: Private remote sync.
- Acceptance: One vault survives restart/export/restore; selected context reaches a run; secret and conflict cases remain safe.
- Verification: `npm run check`, strict OpenSpec, `npm run dev:verify`, and
  production-path vault MCP/live restart/export/restore evidence. Packaged
  macOS evidence remains the separate S4-I03 release gate.
- Evidence (2026-07-15): Tier 1 code-ready/Tier 2
  live-verification-remaining. Vault setup
  now exposes central versus explicit project-owned storage and the independent
  git-tracking opt-in. The vault header routes to the existing reviewed
  export/import surface. Portable import now binds the restored vault root
  identity inside the database transaction; a real migrated-vault round trip
  proves schema version, section versions/hashes, Markdown content, backup
  metadata/content, target-path remapping, and an immediately readable restored
  root. `docs/project-knowledge-vaults.md` documents setup, context, agent
  operations, conflict/recovery, export/import, secrets, and limitations. The
  feature-wide Node 22 slice passes 14 files/120 tests; repository ESLint,
  scoped Prettier, full TypeScript, production build, strict OpenSpec, and diff
  hygiene pass.
  Monolithic `npm run check` passed repository ESLint but stopped on pre-existing
  formatting drift in `docs/stage4-full-feature-test-matrix.md` and Drizzle
  snapshots `0031` through `0034`. Dev, live restart/edit, and clean-profile UI
  import remain open, so completion stays unchecked. Packaged-preview and
  platform certification remain separate.
- Blocked by: S4-F2-T1, S4-F2-T3, S4-F2-T4, S4-F2-T5
- Blocks: Stage S4 integrated exit
- Context: `docs/stage4-full-feature-test-matrix.md`.

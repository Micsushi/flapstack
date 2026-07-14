# S4-F2 — Project Knowledge Vaults

### S4-F2-T1 — Implement and persist the vault location policy

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

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F2
- Outcome: Users can inspect and edit project knowledge with honest conflicts.
- Scope: Project entry, section tree, Markdown viewer/editor, scoped search, change indicators, conflict diff, restore, keyboard/accessibility behavior.
- Out of scope: Full Obsidian plugin or graph support.
- Acceptance: Search stays inside the selected vault; stale saves preserve both versions; secrets never appear in snippets.
- Verification: Component/accessibility, search-scope, stale-save, redaction, and live edit tests.
- Blocked by: S4-F2-T2
- Blocks: S4-F2-T6
- Context: file viewer, scoped search, diff components, project details surfaces.

### S4-F2-T4 — Add explicit run-context loading

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F2
- Outcome: Selected vault sections enter agent context with provenance and budgets.
- Scope: Project/task/run selection, default policy, size/token budget, truncation report, context manifest, supported harness integration.
- Out of scope: Hidden automatic memory selection.
- Acceptance: Only selected sections load; every inclusion and truncation is visible; oversized or unsafe content fails honestly.
- Verification: Resolver, budget, provenance, secret-rejection, and per-harness context tests.
- Blocked by: S4-F2-T2
- Blocks: S4-F2-T5, S4-F2-T6
- Context: agent context/evidence pipeline and run manifests.

### S4-F2-T5 — Add approved agent vault operations

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F2
- Outcome: Authorized agents read and update vault sections through bounded tools.
- Scope: MCP list/read/create/update tools, version preconditions, approval tiers, audit redaction, invalidation, handoff/decision helper operations.
- Out of scope: Secret storage and arbitrary filesystem access.
- Acceptance: Reads honor caller scope; writes require exact section/version and applicable approval; stale/secret writes fail closed.
- Verification: Registry, caller identity, approval, audit, stale-write, secret, and renderer invalidation tests.
- Blocked by: S4-F2-T2, S4-F2-T4 and Stage 3 MCP gate/audit
- Blocks: S4-F2-T6
- Context: app-control MCP registry, gate, audit, and invalidation bridge.

### S4-F2-T6 — Close vault acceptance and recovery

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F2
- Outcome: Vault setup, use, export, and restore pass in Dev and packaged preview.
- Scope: Export/import bundle, schema version, conflict preview, backup restore, full gate, matrix S4-KV01 through S4-KV05, docs and limitations.
- Out of scope: Private remote sync.
- Acceptance: One vault survives restart/export/restore; selected context reaches a run; secret and conflict cases remain safe.
- Verification: `npm run check`, strict OpenSpec, `npm run dev:verify`, and packaged preview matrix evidence.
- Blocked by: S4-F2-T1, S4-F2-T3, S4-F2-T4, S4-F2-T5
- Blocks: Stage S4 integrated exit
- Context: `docs/stage4-full-feature-test-matrix.md`.

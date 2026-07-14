# S4-F8 — Import/Export and Private Sync

### S4-F8-T1 — Define the bundle and scope registry

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F8
- Outcome: Every portable scope has a stable schema/version/dependency/sensitivity contract.
- Scope: Directory layout; manifest/checksum/exclusion schemas; scope registry; settings/extensions/vault/workspace/usage/project/history handlers; import ordering; compatibility policy.
- Out of scope: Reading or writing actual bundles.
- Acceptance: Unknown, cyclic, missing-dependency, future-version, and invalid-scope manifests fail deterministically; registry is self-contained.
- Verification: `npm test -- portability-contract` with manifest and dependency fixtures.
- Blocked by: S4-F1-T3, S4-F2-T2, S4-F4-T2
- Blocks: S4-F8-T2, S4-F8-T3, S4-F8-T4, S4-F8-T6
- Context: disabled `import-export.ts`, extension policy, vault storage, saved workspace schema, OpenSpec project conventions.

### S4-F8-T2 — Add secret classification and exclusion reporting

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F8
- Outcome: Export/import/sync pipelines share one fail-closed secret boundary.
- Scope: Sensitive field registry; structured redaction; text secret scan; credential/session/webhook exclusions; placeholders; category-only report; false-positive override without value disclosure.
- Out of scope: Encrypted secret export.
- Acceptance: Known secrets never enter bundle, preview, log, checksum metadata, git diff, or audit; reports contain categories/paths only.
- Verification: `npm test -- portability-secrets` with provider keys, webhooks, sessions, PEM, env, vault text, and false-positive fixtures.
- Blocked by: S4-F8-T1
- Blocks: S4-F8-T3, S4-F8-T4, S4-F8-T6, S4-F8-T7
- Context: credential storage, usage secrets, audit redaction, vault secret policy.

### S4-F8-T3 — Implement consistent selective export

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F8
- Outcome: Selected scopes produce an integrity-checked bundle from one consistent snapshot.
- Scope: Export plan; project filtering; SQLite backup API; file staging/copy; dependency closure; checksums; exclusion report; cancellation; cleanup; advanced usage CSV/JSON inclusion.
- Out of scope: Import and git sync.
- Acceptance: Live writes do not corrupt snapshot; WAL/SHM and secrets are absent; cancellation removes incomplete output; checksums match all files.
- Verification: `npm test -- portability-export` with concurrent write, cancellation, large history, missing file, checksum, scope, and secret fixtures.
- Blocked by: S4-F7-T6, S4-F8-T1, S4-F8-T2
- Blocks: S4-F8-T4, S4-F8-T7, S4-F8-T8
- Context: SQLite connection/backup, file-backed settings, vaults, workspaces, usage exporter.

### S4-F8-T4 — Implement staged import verification, migration, and diff

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F8
- Outcome: Any bundle can be evaluated fully before live state changes.
- Scope: Manifest/checksum verification; staging database/files; per-scope migrations; identity mapping; create/update/conflict/skip diff; no implicit deletes; unsupported version reporting; dry-run result persistence.
- Out of scope: Applying the diff.
- Acceptance: Invalid/tampered/future bundles stop before mutation; conflicts preserve both values; dry-run is deterministic and restart-readable.
- Verification: `npm test -- portability-import-plan` with tamper, old/new schema, identity collision, conflict, missing dependency, and no-delete fixtures.
- Blocked by: S4-F8-T1, S4-F8-T2, S4-F8-T3
- Blocks: S4-F8-T5, S4-F8-T7, S4-F8-T8
- Context: DB migrator/startup gate, scope registry, path safety, conflict diff components.

### S4-F8-T5 — Apply imports transactionally with rollback and recovery

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F8
- Outcome: Confirmed import plans publish one valid state or restore the prior state.
- Scope: Plan fingerprint/revalidation; pre-import backup; operation journal; DB transaction/replacement; staged atomic file swaps; service pause/restart; rollback; startup recovery; post-apply integrity.
- Out of scope: Git sync and renderer flow.
- Acceptance: Stale plans refuse apply; crash at each journal phase recovers; failure never leaves mixed database/files; backup can restore manually.
- Verification: `npm test -- portability-import-apply` with phase fault injection, stale plan, locked file, DB failure, restart, and rollback fixtures.
- Blocked by: S4-F8-T4
- Blocks: S4-F8-T7, S4-F8-T8
- Context: startup gate, database singleton, atomic settings writes, vault/workspace services.

### S4-F8-T6 — Add explicit user-owned private git sync

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F8
- Outcome: Safe file-backed scopes can synchronize through a user-owned private repository.
- Scope: Repo/link validation; included path manifest; initial clone/init; status/diff; fetch/pull fast-forward; conflict stop; explicit commit/push; branch/remote config; secrets scan before git mutation; unlink.
- Out of scope: Database/history live sync, force push, hosted relay, automatic credential storage, and silent background push.
- Acceptance: Only approved paths enter git; divergence/conflicts stop safely; commit/push show exact diff; no secret or unselected scope is staged.
- Verification: `npm test -- private-sync` with local bare remotes, fast-forward, divergence, conflict, secret, branch, unlink, and retry fixtures.
- Blocked by: S4-F8-T1, S4-F8-T2
- Blocks: S4-F8-T7, S4-F8-T8
- Context: simple-git, git security commands, registered roots, extension/vault file scopes.

### S4-F8-T7 — Build portability and sync UI

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F8
- Outcome: Users select scopes, review exclusions/diffs/conflicts, apply/restore, and manage private sync.
- Scope: Settings entry; export scope/project picker; progress/cancel; import dry-run review; conflict resolution; backup/restore; sync link/status/diff/pull/commit/push/unlink; accessibility; destructive confirmations.
- Out of scope: Hosted account setup and secret export.
- Acceptance: No import or git mutation occurs without exact preview/confirmation; recovery state is actionable; large results paginate.
- Verification: `npm test -- portability-ui` plus accessibility and live export/import/private-sync walkthrough.
- Blocked by: S4-F8-T2, S4-F8-T3, S4-F8-T4, S4-F8-T5, S4-F8-T6
- Blocks: S4-F8-T8
- Context: Settings search, diff viewer, progress dialogs, filesystem pickers, toast/undo patterns.

### S4-F8-T8 — Close portability and private-sync acceptance

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F8
- Outcome: Export, import, recovery, and private sync pass automated/live/package evidence.
- Scope: Full gate; matrix S4-IE01–S4-IE03; selective/full bundles; prior-version migration; tamper/secret/conflict/crash; private remote; docs; package preview.
- Out of scope: Hosted sync and encrypted credentials.
- Acceptance: A clean machine/profile restores selected state; destructive and secret cases fail closed; private sync never force-updates.
- Verification: Node 22 `npm run check`, strict OpenSpec, `npm run dev:verify`, fresh-profile matrix, and packaged preview.
- Blocked by: S4-F8-T3, S4-F8-T4, S4-F8-T5, S4-F8-T6, S4-F8-T7
- Blocks: Stage S4 integrated exit
- Context: `docs/stage4-full-feature-test-matrix.md` and Stage 4 execution plan.

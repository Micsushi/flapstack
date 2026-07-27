# S4-F8 — Import/Export and Private Sync

### S4-F8-T1 — Define the bundle and scope registry

- Evidence class: `T2-core`.
- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F8
- Outcome: Every portable scope has a stable schema/version/dependency/sensitivity contract.
- Scope: Directory layout; manifest/checksum/exclusion schemas; scope registry; settings/extensions/vault/workspace/usage/project/history handlers; import ordering; compatibility policy.
- Out of scope: Reading or writing actual bundles.
- Acceptance: Unknown, cyclic, missing-dependency, future-version, and invalid-scope manifests fail deterministically; registry is self-contained.
- Verification: `npm test -- portability-contract` with manifest and dependency fixtures.
- Blocked by: S4-F1-T3, S4-F2-T2, S4-F4-T2
- Blocks: S4-F8-T2, S4-F8-T3, S4-F8-T4, S4-F8-T6
- Context: disabled `import-export.ts`, extension policy, vault storage, saved workspace schema, OpenSpec project conventions.
- Evidence: The versioned bundle layout, seven active non-mobile scope contracts, deterministic dependency closure/import ordering, tri-state project filtering, compatibility policy, UTF-8/path bounds, and canonical collision rejection pass Node 22 contract coverage. History is now truthfully database metadata; attachment/audio files and machine-local paths are not declared portable file content.

### S4-F8-T2 — Add secret classification and exclusion reporting

- Evidence class: `T2-core`.
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
- Evidence: Portability reuses the project-vault provider-family detector and adds shared structured/assignment aliases for AWS/Google credentials. The fail-closed boundary handles JSON, plain and quoted/export assignments, text candidates, category/path-only exclusions, placeholders, hash-only overrides, redacted conflict previews, and exact incoming/outgoing Git blob scans. Node 22 coverage proves bare AWS/Google keys and prefix-free AWS secret assignments stay out of bundles, previews, and committed-blob sync.

### S4-F8-T3 — Implement consistent selective export

- Evidence class: `T2-core`.
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
- Evidence: Deterministic selected-scope export uses the SQLite backup API, explicit per-table project relationships, portable selected records, safe file staging, complete checksums/exclusions, usage JSON/CSV, abort cleanup, and no WAL/SHM. Node 22 passes one-project parent/dependent filtering, 2,000-row concurrent history, byte determinism, cancellation/tamper cases, deterministic moved/removed source refusal with partial-output cleanup, and proof that source-machine paths never enter the bundle.

### S4-F8-T4 — Implement staged import verification, migration, and diff

- Evidence class: `T2-core`.
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
- Evidence: Full bounded verification precedes persistent staging and deterministic create/update/conflict/skip planning. Streaming checksums and preflighted SQLite record/JSON limits prevent unbounded allocation; oversized files, databases, records, and plans fail with documented limits. Every JSON metadata/index read uses one size-capped handle with pre/open/post regular-file identity checks. Directory discovery stops at the explicit checksum-entry traversal cap. The portable SQLite file is copied from one no-follow identity-bound handle into an app-owned temporary directory before parsing, so leaf swaps fail and WAL/SHM sidecars are never consulted. Existing file leaves must be regular non-symlinks and their identity/content is bound before preview; fallback remains fail-closed without a platform no-follow flag. Persisted plans are strict-schema parsed and retain redacted values, reviewed targets, hashes, no deletes, and restart-readable state. The confirmation hash binds bundle, targets, decisions, hashes, and resolutions. Explicit project/vault mappings reject canonical destination ambiguity, portable path markers bind to the exact record identity, multiple bundle files cannot converge on one live target, and matching local identities do not lstat stale source/worktree roots. Node 22 passes fallback symlinks, metadata/database swaps, sidecar isolation, growing/oversized JSON, traversal caps, tamper, stale confirmation, migration, mappings, and empty-profile cases.

### S4-F8-T5 — Apply imports transactionally with rollback and recovery

- Evidence class: `T2-core`.
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
- Evidence: Apply, startup recovery, and manual restore share an exclusive portability operation lease and one production database maintenance lease. Canonical cross-process markers block every lease-aware production opener, tRPC and MCP dispatch hold async singleton-operation leases, and maintenance pauses the dev MCP server/schedulers/sessions, stops the exact installed profile daemon, drains admitted readers/writers, then closes the singleton. Dead owner/access markers are removed only with process-death or process-start-identity proof. Marker reads use one bounded no-follow descriptor, and release/orphan cleanup atomically quarantines before deleting only an exact bound inode/content; replacement live markers remain blocking in quarantine. Only a proven-running service restarts; stored SQLite PIDs are never signaled. File backup/preserve/publish/remove/rollback bind reviewed roots/leaves, reject leaf/ancestor symlink swaps, and use no-follow source descriptors. Journal v2 binds every database/file backup by hash, bytes, device, and inode and binds recovery to the active profile database path, so symlink and different-regular-file replacements fail before live overwrite. Apply orders declared dependencies, checks FKs, materializes both conflict versions, and restores `database-applying` as potentially committed. Node 22 passes cached-service and async-singleton draining, alias/orphan/live-marker handling, exact owner/access replacement-boundary and symlink-swap denial, daemon/MCP/automation openers, apply/rollback backup replacements, five faults, recovery/restore, FK rollback, clean-profile roots, and keep-both artifacts.

### S4-F8-T6 — Add explicit user-owned private git sync

- Evidence class: `T2-capability:private-sync`.
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
- Evidence: Persisted config derives included paths from validated scopes, revalidates absolute non-symlink repo/attached branch/both origin URLs, and rejects credential-bearing URLs. Preview persists exact local/remote OIDs and audits every incoming/outgoing path/blob. Worktree preview reads one bounded no-follow snapshot; secret scan and Git blob OID derive from those identical bytes. Mid-read changes and leaf symlinks fail, and only exact `sha1`/`sha256` object formats are accepted. Reviewed ranges fail closed above 64 commits, 256 changed paths per commit, 2,048 total changed paths, 4 MB per blob, or 16 MB total scanned blob bytes; Git output is bounded before parsing, and confirmation reuses the same range audit. One bounded reviewed-remote ref replaces repeated previews and is removed after mutations/unlink. Commit builds the reviewed tree/commit against the reviewed parent through an isolated index and CAS-updates the branch; concurrent HEAD movement leaves competing ref/index untouched, including SHA-256 unborn repositories where supported. Pull merges the exact fetched OID. Push sends the exact reviewed local OID with a server-side expected-old-OID lease, including the missing-branch zero OID; reviewed ancestry forbids divergent force updates, and a move or deletion after the final precheck fails atomically. Node 22 local-bare-remote coverage passes bounded-history rejection, parsed path/blob budgets, snapshot races, object-format/advertisement rejection, commit CAS and push-lease movement/deletion races, bounded refs, SHA-256 creation, unapproved ranges, secrets, hardening, dirty pull, and unlink.

### S4-F8-T7 — Build portability and sync UI

- Evidence classes: `T2-core` for portability UI;
  `T2-capability:private-sync` for sync UI.
- [ ] Completion: portability UI acceptance and verification passed
- Separate certification: Private-sync UI remains with S4-IE03.
- Parent: Project Flapstack / Stage S4 / Feature S4-F8
- Outcome: Users select scopes, review exclusions/diffs/conflicts, apply/restore, and manage private sync.
- Scope: Settings entry; export scope/project picker; progress/cancel; import dry-run review; conflict resolution; backup/restore; sync link/status/diff/pull/commit/push/unlink; accessibility; destructive confirmations.
- Out of scope: Hosted account setup and secret export.
- Acceptance: No import or git mutation occurs without exact preview/confirmation; recovery state is actionable; large results paginate.
- Verification: `npm test -- portability-ui` plus accessibility and live export/import/private-sync walkthrough.
- Blocked by for `T2-core`: S4-F8-T2, S4-F8-T3, S4-F8-T4, and
  S4-F8-T5.
- Separate private-sync UI certification depends on S4-F8-T6.
- Blocks: S4-F8-T8
- Context: Settings search, diff viewer, progress dialogs, filesystem pickers, toast/undo patterns.
- Evidence: Code and five Node 22 UI contract tests pass for the searchable route, native pickers, reviewed target mappings/actual target paths, preview invalidation on mapping edits, canonical confirmation hashes, independent 50-row import and private-sync pagination with reset/clamping, redacted values, truthful keep-both wording, exact sync OIDs/blob deltas, conflict blocking, keyboard-native controls, labeled pagination regions, fieldsets, and live regions. Live visual/accessibility walkthrough remains open because the Mac session is locked.

### S4-F8-T8 — Close portability and private-sync acceptance

- Evidence classes: `T2-core` for S4-IE01 and S4-IE02;
  `T2-capability:private-sync` for S4-IE03.
- [ ] Completion: S4-IE01 and S4-IE02 are accepted
- Separate certification: S4-IE03 retains independent private-sync status.
- Parent: Project Flapstack / Stage S4 / Feature S4-F8
- Outcome: Export, import, recovery, and private sync pass automated/live/package evidence.
- Scope: The `T2-core` closeout covers S4-IE01 and S4-IE02,
  selective/full bundles, prior-version migration,
  tamper/secret/conflict/crash, and docs. S4-IE03 retains private-sync
  capability status; packaged macOS evidence remains S4-I03.
- Out of scope: Hosted sync and encrypted credentials.
- Acceptance: A clean machine/profile restores selected state; destructive and secret cases fail closed; private sync never force-updates.
- Verification: Node 22 `npm run check`, strict OpenSpec,
  `npm run dev:verify`, and fresh-profile export/import MCP/live evidence.
  Private-remote and packaged-preview evidence stays in the separately labeled
  capability and release rows.
- Blocked by for `T2-core`: S4-F8-T3, S4-F8-T4, S4-F8-T5, and the
  `T2-core` scope of S4-F8-T7.
- Separate private-sync certification depends on S4-F8-T6 and the matching
  capability scope of S4-F8-T7.
- Blocks: Stage S4 integrated exit
- Context: `docs/stage4-full-feature-test-matrix.md` and Stage 4 execution plan.
- Evidence: The recovered snapshot previously passed its Node 22 repository gate at 185 files, 1,453 passed, and 3 skipped. Against the frozen integration base, the F8/F2 focused gate passed 15 files and 147 tests, including moved/removed export sources, mapping/target ambiguity, marker identity, stale-root independence, exact vault content/type/version/hash/backup/schema, marker replacement, orphan recovery, async singleton drain, rollback, malformed advertisement, and remote move/delete races. The additive F2/KV05 coexistence repair now passes the exact accepted remapping suite plus F8 importer/apply/vault regressions at 4 files and 40 tests; the retained packet slice passes 3 files and 36 tests. Current TypeScript, touched ESLint/Prettier, and diff checks pass; the earlier production build and strict F8/F2 OpenSpec checks remain green. The current full-repository attempt stopped after 245 of 248 files passed, 2,018 tests passed, and 3 skipped because three unrelated integrated stabilization test files remain stale; priority explicitly defers another broad loop. S4-IE01-S4-IE03 remain open pending the full stabilization gate, unlocked UI walkthrough, real clean-profile/package restore, real user-owned private-remote proof, packaged macOS preview, and Windows/Linux package evidence.

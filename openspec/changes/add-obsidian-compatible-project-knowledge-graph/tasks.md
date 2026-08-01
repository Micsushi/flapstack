# S6-F12 — Obsidian-Compatible Project Knowledge Graph

### S6-F12-T1 — Migrate typed sections into stable seed-note identities

- Evidence class: `T2-core`.
- [x] T2-core completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F12
- Outcome: Existing and new vaults expose the six typed sections as durable seed nodes without data or recovery loss.
- Scope: Additive note/scan schema; stable IDs; reserved frontmatter; section-to-note mapping; migration journal; backups; rollback; restart and worktree invariants.
- Out of scope: Custom-note UI, link parsing, graph rendering.
- Acceptance: Existing content/version/hash/backups/context selections survive; failed or externally changed migration applies nothing; new vaults produce six optional seed templates.
- Verification: Migration, rollback, interrupted-upgrade, Stage 4 fixture, restart, central/project-owned, and schema-rebuild tests.
- Blocked by: fully accepted S4-F2 and Stage 5 exact SHA
- Blocks: S6-F12-T2, S6-F12-T3, S6-F12-T5, S6-F12-T7, S6-F12-T8
- Context: `projectVaults`, `projectVaultSections`, storage backups, registry, filesystem-root identity, Stage 4 export fixtures.

### S6-F12-T2 — Enforce Obsidian-open and Git-safe vault location behavior

- Evidence class: `T2-core`.
- [x] T2-core completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F12
- Outcome: Central and project-owned vaults open in Obsidian without making project memory commit-eligible by default.
- Scope: Encoded absolute-path Obsidian URI; availability/fallback UX; preserve/ignore `.obsidian`; project-owned local Git common-dir exclusion; `git check-ignore`; tracking opt-in/removal; worktrees; diagnostics.
- Out of scope: Installing Obsidian, editing committed `.gitignore`, enabling plugins, staging or committing files.
- Acceptance: Central mode remains outside Git; project-owned untracked setup fails before writes if local exclusion cannot be verified; separate tracking confirmation reverses only Flapstack-owned exclusion; open/reveal/copy paths are truthful.
- Verification: URI encoding, missing-app fallback, normal/bare/worktree Git fixtures, tracked/untracked transitions, restart, and macOS/Windows/Linux adapter tests.
- Blocked by: S6-F12-T1
- Blocks: S6-F12-T4, S6-F12-T5, S6-F12-T8
- Context: project-vault policy, Git path resolution/security, Electron shell integration, portability location mapping.

### S6-F12-T3 — Parse and resolve the supported Obsidian Markdown subset

- Evidence classes: `T2-core`, `T2-capability:real-obsidian-created-content`.
- [x] T2-core completion: acceptance and verification passed
- [ ] Capability evidence: `T2-capability:real-obsidian-created-content` remains uncertified.
- Parent: Project Flapstack / Stage S6 / Feature S6-F12
- Outcome: Markdown produces deterministic portable note metadata and link candidates without destructive rewriting.
- Scope: Byte-preserving frontmatter; reserved IDs/types; aliases/tags; Wikilinks; headings; block IDs; embeds; relative Markdown links; Unicode/case/path normalization; unresolved/ambiguous diagnostics; secret-safe metadata.
- Out of scope: Obsidian plugin grammar, Canvas, Bases, Dataview execution, external URLs as graph nodes.
- Acceptance: Supported syntax matches declared Obsidian fixtures; unsupported/malformed syntax survives unchanged; links never escape root or guess ambiguous targets.
- Verification: Golden parser corpus, round-trip/property fuzzing, Unicode/case fixtures, path attacks, malformed/secret fixtures, and real Obsidian-created notes.
- Blocked by: S6-F12-T1
- Blocks: S6-F12-T4, S6-F12-T5, S6-F12-T6, S6-F12-T7
- Context: Markdown renderer, project-vault content safety, path safety, Obsidian internal-link and property contracts.

### S6-F12-T4 — Build the rebuildable graph index and external-change watcher

- Evidence class: `T2-core`.
- [x] T2-core completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F12
- Outcome: Nodes, edges, backlinks, search, and change state stay coherent across Flapstack and Obsidian edits.
- Scope: Node/edge/attachment tables; immutable scan generations; full/incremental rescan; debounced watcher; create/edit/move/rename/delete; crash recovery; invalidation; unresolved links; index rebuild.
- Out of scope: Graph visualization and automatic run-context traversal.
- Acceptance: Queries never mix generations; watcher storms coalesce without missed final state; removed SQLite indexes rebuild from files; conflicts/unsafe content fail closed without deleting source.
- Verification: Deterministic filesystem-event harness, atomic-replace races, rename/move identity, crash/restart, index deletion/rebuild, concurrent editor, symlink/root replacement, and large fixture tests.
- Blocked by: S6-F12-T2, S6-F12-T3
- Blocks: S6-F12-T5, S6-F12-T6, S6-F12-T7, S6-F12-T8
- Context: project-vault storage/browser, tRPC invalidation, filesystem-root registration, portability journals.

### S6-F12-T5 — Add custom-note, folder, attachment, and conflict workflows

- Evidence classes: `T2-core`, `T2-capability:real-obsidian-crud-roundtrip`.
- [x] T2-core completion: acceptance and verification passed
- [ ] Capability evidence: `T2-capability:real-obsidian-crud-roundtrip` remains uncertified.
- Parent: Project Flapstack / Stage S6 / Feature S6-F12
- Outcome: Users manage an extensible Obsidian-compatible note tree while seed notes retain typed behavior.
- Scope: Create/open/edit/move/rename/delete custom notes/folders; safe attachments/embeds; tree/search; frontmatter properties; broken links; external indicators; exact diff/conflict/adopt/restore; multi-window drafts.
- Out of scope: Graph layout, arbitrary binaries in agent context, deleting non-empty folders without exact confirmation.
- Acceptance: Operations preserve stable identity/backlinks or surface exact breakage; unsupported files remain untouched; stale/external edits preserve both versions; every destructive operation is scoped and recoverable.
- Verification: Storage/router/component tests, keyboard/reader tree, multi-window races, attachment/path/size/secret fixtures, external Obsidian CRUD round trip, backup restore, and restart.
- Blocked by: S6-F12-T1, S6-F12-T2, S6-F12-T3, S6-F12-T4
- Blocks: S6-F12-T6, S6-F12-T8, S6-F12-T9
- Context: project-vault renderer/editor state, tree navigation, Chat Markdown renderer, backup/restore services.

### S6-F12-T6 — Add accessible backlinks, local graph, and whole-vault graph

- Evidence classes: `T2-core`, `T2-capability:native-assistive-technology`.
- [x] T2-core completion: acceptance and verification passed
- [ ] Capability evidence: `T2-capability:native-assistive-technology` remains uncertified.
- Parent: Project Flapstack / Stage S6 / Feature S6-F12
- Outcome: Users inspect and navigate project knowledge relationships visually or through an equivalent list.
- Scope: Backlinks/outlinks; local/full graph; node focus/open; filters by seed/type/tag/folder/link state; search; progressive layout; graph adapter; selected-node details; keyboard/touch/reader/reduced-motion/list fallback; multi-window state.
- Out of scope: Collaborative graph editing, 3D graph, Canvas replacement, semantic/vector similarity edges.
- Acceptance: Every rendered node/edge matches the selected scan generation and list equivalent; graph does not invent relationships; large graphs degrade to bounded filtered/local views without blocking note access.
- Verification: Query/adapter/component tests, graph-list equivalence, visual fixtures, keyboard/touch/VoiceOver/NVDA/Orca, 80-200% zoom, reduced motion, multi-window, and declared scale fixture.
- Blocked by: S6-F1-T2, S6-F12-T3, S6-F12-T4, S6-F12-T5
- Blocks: S6-F12-T9
- Context: root `ui-design.md`, shared Stage 6 primitives, project-vault navigation, candidate Cytoscape adapter.

### S6-F12-T7 — Extend explicit run context and approved agent note operations

- Evidence class: `T2-core`.
- [x] T2-core completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F12
- Outcome: Custom nodes help agents without turning links into hidden memory or arbitrary filesystem access.
- Scope: Exact node selection at project/task/run; optional previewed depth/direction/budget expansion; provenance manifests; truncation/rejection; bounded MCP list/read/create/update/move helpers; approval/audit/invalidation; seed helpers.
- Out of scope: Automatic semantic retrieval, unlimited recursive traversal, secret injection, arbitrary path tools, graph-wide writes.
- Acceptance: Unselected linked notes never load; expanded nodes record the exact edge/reason; stale/unsafe/out-of-scope operations deny; audit contains no content; harnesses receive identical manifests.
- Verification: Resolver/traversal budgets, cycles, provenance, truncation, secret/rejection, caller scope, approval, audit redaction, invalidation, Codex/Claude/Runtime, retry/restart, and mixed seed/custom tests.
- Blocked by: S6-F12-T1, S6-F12-T3, S6-F12-T4
- Blocks: S6-F12-T9
- Context: Stage 4 run-context manifests, MCP project-vault service, approval gate, harness launch paths.

### S6-F12-T8 — Extend portability, recovery, and security to graph vaults

- Evidence class: `T2-core`.
- [x] T2-core completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F12
- Outcome: Interoperable vaults survive export/import, root remapping, corruption, and recovery without trusting derived indexes or unsafe Obsidian state.
- Scope: Versioned graph bundle; notes/folders/safe attachments/frontmatter/backups; `.obsidian` exclusion; dry-run mapping/conflicts; derived-index rebuild; interrupted operations; rollback; orphan/broken link report; threat model and diagnostics.
- Out of scope: Hosted/Obsidian Sync, community-plugin backup, credentials, importing the user's unrelated global vault automatically.
- Acceptance: Cross-machine restore preserves stable nodes/links/content and rebuilds indexes; secrets/unsafe attachments/config remain excluded; corruption never overwrites source; rollback is restorable.
- Verification: Real migrated-vault round trip, central/project-owned remapping, missing/corrupt DB, interrupted journal, backup restore, checksum/foreign-key/root identity, secret/plugin/path/symlink attacks, and clean profile.
- Blocked by: S6-F12-T1, S6-F12-T2, S6-F12-T4, S6-F12-T5
- Blocks: S6-F12-T9
- Context: Stage 4 project-vault export/import, private-sync bundle registry, filesystem root binding, operation journal.

### S6-F12-T9 — Close Obsidian and knowledge-graph acceptance

- Evidence classes: `T2-core`, `T2-capability:real-obsidian-interoperability`, `release-gate`.
- [x] T2-core completion: acceptance and verification passed
- [ ] Capability evidence: `T2-capability:real-obsidian-interoperability` remains uncertified.
- [ ] Release evidence: `release-gate` remains uncertified for native-distribution-knowledge-graph.
- Parent: Project Flapstack / Stage S6 / Feature S6-F12
- Outcome: One exact SHA proves the same project vault in Flapstack and real Obsidian with truthful Git, graph, context, recovery, accessibility, performance, and package behavior.
- Scope: Matrix S6-KG; fresh/Stage 4 upgrade; central/project-owned; real Obsidian create/edit/link/rename/attachment/conflict; graph/list; agent context; export/import; Git status; restart; scale; docs/help; native packages.
- Out of scope: Unsupported Obsidian plugins, hosted sync, automatic release or repository commits.
- Acceptance: All S6-KG rows pass; no knowledge file is commit-eligible by default; no P0/P1 or acceptance blocker; supported syntax/limits and unsupported behavior are documented.
- Verification: Node 22 `npm run check`; strict OpenSpec; `npm run dev` plus `npm run dev:verify`; S6-F9 budgets; real Obsidian and package walkthroughs on promoted platforms; exact-SHA evidence crosswalk.
- Blocked by for T2-core: the `T2-core` scopes of S6-F12-T5, S6-F12-T6, S6-F12-T7, S6-F12-T8, and S6-F9-T8.
- Release certification remains blocked by: S6-F10-T8.
- Blocks: S6-F11-T1
- Context: `docs/stage6-full-feature-test-matrix.md`, `docs/stage6-execution-plan.md`, project knowledge docs, root `ui-design.md`.

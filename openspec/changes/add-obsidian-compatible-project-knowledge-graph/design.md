## Context

Stage 4 stores six typed Markdown sections with SQLite-owned versions, hashes,
backups, location policy, and explicit run selection. That model is safe but not
Obsidian-like: it has no arbitrary notes, Wikilink graph, backlinks, attachments,
or one-click Obsidian opening. Stage 5 extends it without changing Stage 4 task
truth or moving default memory into a repository.

## Goals / Non-Goals

- Goals: six seed notes plus custom nodes within declared limits; interoperable Markdown;
  Obsidian-style links; backlinks and graph views; external-editor safety;
  rebuildable indexes; explicit agent/run scope; private local storage by default.
- Non-goals: Obsidian plugin/API emulation, arbitrary community-plugin support,
  Canvas/Bases parity, hosted sync, automatic repository commits, credential
  storage, hidden memory traversal, or importing the user's separate global vault.

## Decisions

### Markdown owns knowledge; SQLite owns rebuildable operational state

- Every node is a Markdown file under one registered vault root. Files and safe
  attachments are the portable source of truth.
- SQLite stores stable IDs, normalized paths, versions, hashes, parsed metadata,
  edges/backlinks, scan generation, backup inventory, permissions, and context
  selections. Node/edge/search state must rebuild from files and reserved metadata.
- Flapstack-managed notes use preserved YAML frontmatter keys
  `flapstack-id`, `flapstack-kind`, and optional `flapstack-section`. User-owned
  properties, aliases, and tags are preserved byte-for-byte where possible.
- Existing six files migrate in place, with verified backups, into seed/system
  nodes. Their stable section semantics remain; they no longer limit vault size.

### Obsidian-compatible subset is explicit

- Resolve `[[Note]]`, `[[Note|Alias]]`, heading links, block links, embeds, normal
  relative Markdown links, aliases, tags, and safe attachment references.
- Resolution follows normalized vault-relative paths and records unresolved and
  ambiguous links honestly. It never guesses across projects or outside the root.
- `.obsidian/` is preserved but ignored by graph, search, run context, agent
  operations, and default export. Flapstack never enables community plugins.
- `.backups/` and other Flapstack-reserved internals remain hidden from Obsidian
  knowledge indexing and agent context.

### Same-folder interoperability, not synchronization

- Flapstack and Obsidian edit the same files. There is no second synchronized copy.
- A debounced watcher produces immutable scan generations. Writes still use exact
  version/content-hash compare-and-swap and atomic replacement.
- External create, edit, move, rename, and delete events update the index only
  after root, symlink, size, content-safety, and identity checks. Conflicts preserve
  both the Flapstack draft and current disk content.
- `Open in Obsidian` uses an encoded absolute-path URI. If Obsidian is unavailable,
  Flapstack offers Reveal Folder and Copy Path without claiming integration.

### Git safety is independent from Obsidian compatibility

- App-managed central storage remains the default and stays outside the repository.
  It can still be registered as an Obsidian vault.
- Project-owned `.flapstack/knowledge/` remains explicit. With repository tracking
  disabled, setup manages a local Git exclude through the resolved Git common dir
  and verifies it with `git check-ignore`; it does not modify committed `.gitignore`.
- If local exclusion cannot be verified, project-owned setup fails before writing
  knowledge. Removing the exclusion requires a separate tracking confirmation.
- Flapstack never stages or commits knowledge files.

### Graph is derived and bounded

- Nodes come from indexed Markdown; edges come from resolved links. Backlinks,
  local graphs, and whole-vault graphs share one query model.
- Index is transactional by scan generation so UI and run manifests never combine
  old nodes with new edges.
- The default graph opens around the selected node. Whole-vault mode filters and
  progressively lays out larger graphs instead of blocking the renderer.
- The renderer uses a replaceable graph adapter. Cytoscape may become a direct
  dependency after license/bundle verification; graph truth remains library-neutral.
- Every visual graph has an equivalent searchable node/edge/backlink list, keyboard
  traversal, screen-reader labels, focus restoration, and reduced-motion behavior.

### Context and agents remain explicit

- Seed and custom notes are never injected merely because they are linked.
- Project, task, and run selection names exact note IDs. Optional link expansion
  requires explicit depth, direction, byte/token budget, and a visible preview.
- Run manifests record each included node, source path, version/hash, inclusion
  reason, traversal edge, bytes/tokens, truncation, and rejection.
- MCP reads and mutations remain project-scoped, ID/version-bound, approval-gated,
  audited, path-safe, and secret-safe. Arbitrary filesystem paths stay unavailable.

## Data and module boundaries

- Schema: additive note, edge, attachment, and scan-generation tables; existing
  section rows migrate to seed-note identities without destructive replacement.
- Main process: extend `src/main/lib/project-vaults/` with note storage,
  frontmatter/link parsing, graph indexing, watching, and Obsidian/Git integration.
- Transport: extend `src/main/lib/trpc/routers/project-vaults.ts` and bounded MCP
  operations with stable note IDs, versions, and graph/context query contracts.
- Renderer: evolve `src/renderer/features/project-vault/` into tree/editor,
  backlinks, local graph, whole graph, filters, conflict, and Obsidian-open surfaces.
- Portability: export Markdown, safe attachments, stable metadata, and graph schema;
  rebuild derived indexes after dry-run import instead of trusting imported indexes.

## Risks / Trade-offs

- Two editors can race. Mitigation: watcher generations plus existing exact CAS,
  atomic writes, backups, and explicit conflict resolution.
- Wikilink semantics can drift from Obsidian. Mitigation: document/test the supported
  subset against real Obsidian and preserve unsupported syntax without rewriting it.
- Graphs can overwhelm renderer/accessibility. Mitigation: local-first graph,
  progressive whole-vault layout, filters, list fallback, and S5-F9 budgets.
- Frontmatter migration can create noisy diffs. Mitigation: central storage default,
  one reserved identity block, backups, byte-preserving parser, and local Git exclude.
- Obsidian plugins can write unsafe content. Mitigation: preserve disk content but
  quarantine it from previews/search/context/agents until safely reconciled.

## Migration Plan

1. Back up and validate every Stage 4 section and vault root identity.
2. Add graph schema without dropping section metadata.
3. Assign stable note IDs and reserved frontmatter to the six seed files through
   exact CAS; externally changed or unsafe files block migration without partial apply.
4. Run a full scan and compare rebuilt seed-node versions/hashes to Stage 4 truth.
5. Enable custom notes, watcher, links, and graph only after successful generation.
6. Export before/after fixtures and prove rollback reopens the Stage 4 representation.

## Verification strategy

- Parser corpus for Wikilinks, aliases, headings, blocks, embeds, frontmatter,
  Unicode/case behavior, malformed syntax, ambiguous links, and secret-like content.
- Filesystem fixtures for external create/edit/move/rename/delete, symlinks, escapes,
  watcher storms, atomic replace, stale writes, crashes, and rebuilds.
- Renderer tests for tree, backlinks, graph/list equivalence, keyboard, screen reader,
  reduced motion, zoom, multi-window, and large-vault filtering.
- Real Obsidian round trips on app-managed and project-owned vaults, including edits,
  renames, links, attachments, conflicts, restart, export/import, and package profiles.
- Node 22 full gate, strict OpenSpec, `npm run dev:verify`, Stage 5 matrix, S5-F9
  performance budgets, and native package evidence before feature exit.

## Open Questions

None blocking. The supported Obsidian subset, storage ownership, Git policy,
context boundary, graph derivation, and migration behavior are fixed above.

# Change: Add an Obsidian-compatible project knowledge graph

## Why

Stage 4 project vaults provide safe typed Markdown, but their six fixed sections
are context slots rather than an extensible note graph. Users who already use
Obsidian need one shared Markdown vault instead of a second isolated notebook.

## What Changes

- Retain Index, Handoff, Decisions, Context, Tasks, and Logs as typed seed notes.
- Add custom Markdown notes, folders, safe attachments, stable note
  identity, preserved frontmatter, aliases, and tags.
- Parse Obsidian-style Wikilinks, headings, blocks, aliases, and embeds into a
  rebuildable node/edge/backlink index.
- Add note-tree, backlinks, local-graph, and whole-project graph surfaces with
  accessible non-graph equivalents.
- Add filesystem watching, external-editor conflict handling, and one-click
  opening of either central or project-owned storage in Obsidian.
- Keep app-managed storage outside Git by default. Project-owned storage remains
  explicit and is locally excluded unless repository tracking is separately enabled.
- Extend explicit run-context selection, bounded agent operations, export,
  restore, and recovery to custom notes without hidden graph traversal.

## Impact

- Affected specs: new project-knowledge-graph capability extending Stage 4
  project-knowledge-vaults.
- Affected code: project-vault schema/storage/parser/indexer/watcher, tRPC/MCP,
  renderer navigation/editor/graph, portability, Git policy, packages, and tests.
- Stage placement: S6-F12. Stage 4 remains the required fixed-section foundation.

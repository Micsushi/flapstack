# Project Knowledge Vaults

Project knowledge vaults keep durable Markdown for one registered project. Open
**Project knowledge** from the project sidebar.

## Setup and storage

Choose the typed sections to create. The default location is app-managed central
storage under the Flapstack profile. Project-owned storage creates
`.flapstack/knowledge/` under the registered project root only after explicit
selection. Git tracking is a separate project-owned opt-in; Flapstack never
commits vault files automatically.

The location, root, and tracking state remain visible in the vault. A scaffolded
vault cannot change location. Delete it with the exact current deletion contract
before choosing a different location; deletion is never inferred from project or
worktree removal.

## Sections and run context

The built-in section IDs are `index`, `handoff`, `decisions`, `context`, `tasks`,
and `logs`. Each section has stable metadata, a Markdown file, a version, and a
content hash. The vault browser hides unsupported metadata instead of rewriting
it.

Run context is opt-in. Check only the project sections that new project runs may
load. Task or individual-run selections can narrow or replace that project
default. Every run manifest records the source, version, hash, included bytes,
token estimate, and truncation. Unsafe or externally changed content rejects the
whole vault context instead of being injected partially.

## Editing, conflicts, and recovery

Search is restricted to the selected project vault. Secret-like values are
redacted before matching and snippet creation. Saves use an exact version and
file-content compare immediately before atomic replacement. Concurrent app,
agent, or external-editor changes open an explicit conflict path and preserve the
local draft.

Every successful replacement stores the prior version as a verified backup.
Version history previews a backup before restoring it as a new version. Missing
section files can be recovered from a verified backup without recreating the
vault. Root replacement, symlinks, escaped paths, stale metadata, unreadable
files, and mismatched backup hashes fail closed.

## Export and import

Use **Export or restore** in the vault header, or open **Settings > Portability &
private sync**. Select **Project vaults** and optionally filter to projects. The
versioned `.flapstack-export` bundle contains selected vault files, schema and
section metadata, backup metadata, checksums, and a category-only exclusion
report. Detected secrets are replaced with an exclusion marker and never copied
verbatim.

Import always starts with a dry-run. Source-machine project and vault paths are
placeholders; review explicit target mappings and every conflict before apply.
Apply publishes files and database metadata transactionally, binds the restored
vault root identity, checks foreign keys, and keeps a restorable operation backup.
Interrupted operations recover from their journal. Private git sync belongs to
the separate portability feature and is not required to back up or restore a
vault.

## Agent operations and limitations

Approved agents can list and read scoped sections and can create or update exact
section/version targets through the existing MCP approval and audit gate. Handoff
and decision helpers remain bounded to their typed sections. Secret content,
arbitrary paths, archived or out-of-scope projects, stale caller identity, and
stale versions are denied. Audit summaries never include vault content.

Vaults are not a credential store, hidden memory system, hosted sync service,
general note-taking plugin platform, or automatic git workflow. Live visual,
packaged-app, and Windows/Linux evidence stays open until observed on those
targets.

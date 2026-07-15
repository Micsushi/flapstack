## ADDED Requirements

### Requirement: Seed notes and extensible knowledge nodes

Flapstack SHALL preserve the six Stage 4 typed sections as seed/system notes and
SHALL allow custom Markdown notes and folders inside the same vault up to
declared storage and performance limits.

#### Scenario: User creates a note from Decisions

- **WHEN** the user creates an architecture note linked from Decisions
- **THEN** the note receives stable identity and both notes remain independently editable

#### Scenario: Existing Stage 4 vault upgrades

- **WHEN** the graph schema is introduced
- **THEN** all six section contents, versions, hashes, backups, and selections survive as seed nodes

### Requirement: Obsidian-compatible Markdown semantics

Flapstack SHALL preserve frontmatter and support the declared Obsidian-compatible
subset for Wikilinks, aliases, headings, blocks, embeds, tags, and attachments.

#### Scenario: Note uses an aliased heading link

- **WHEN** a note contains `[[Decision Log#Storage|storage decision]]`
- **THEN** Flapstack resolves the target/heading, displays the alias, and records one edge

#### Scenario: Syntax is unsupported

- **WHEN** an Obsidian plugin writes syntax outside the supported subset
- **THEN** Flapstack preserves it without silently rewriting or treating it as a resolved edge

### Requirement: Rebuildable node, edge, and backlink index

Flapstack SHALL derive graph/search state from Markdown and reserved portable
identity while publishing only internally consistent scan generations.

#### Scenario: SQLite graph index is removed

- **WHEN** the vault is rescanned from intact files
- **THEN** stable nodes, resolved edges, backlinks, and unresolved-link diagnostics rebuild

#### Scenario: Link target is ambiguous

- **WHEN** multiple notes match a Wikilink
- **THEN** no guessed edge is created and the ambiguity is visible for resolution

### Requirement: Safe same-folder Obsidian interoperability

Flapstack SHALL allow Obsidian and Flapstack to edit the same vault folder while
preserving exact conflicts, backups, root safety, and unsupported content.

#### Scenario: Obsidian edits a loaded note

- **WHEN** Flapstack holds an unsaved draft and the file changes externally
- **THEN** the draft and disk version are both preserved and explicit reconciliation is required

#### Scenario: User opens a central vault in Obsidian

- **WHEN** Obsidian is available and the user selects Open in Obsidian
- **THEN** Flapstack opens the registered absolute vault path without moving it into the repository

### Requirement: Git-safe storage policy

Flapstack SHALL keep app-managed vaults outside repositories and SHALL prevent
untracked project-owned knowledge unless repository tracking is separately enabled.

#### Scenario: Default project memory is created

- **WHEN** the user accepts app-managed storage
- **THEN** knowledge stays under the Flapstack profile and cannot enter the project commit

#### Scenario: Project-owned storage remains untracked

- **WHEN** the user opts into `.flapstack/knowledge/` without repository tracking
- **THEN** Flapstack verifies a local Git exclusion before creating vault content

### Requirement: Accessible tree, backlinks, and graph views

Flapstack SHALL provide note-tree, backlinks, local-graph, and whole-vault graph
views with equivalent non-visual access to every node and edge.

#### Scenario: Keyboard user inspects neighbors

- **WHEN** the user focuses a node and requests linked notes
- **THEN** outgoing and incoming links are navigable, named, and openable without a pointer

#### Scenario: Vault exceeds the direct-layout threshold

- **WHEN** the whole graph exceeds the supported immediate render budget
- **THEN** Flapstack applies filters/progressive layout and keeps local/list views usable

### Requirement: Explicit graph-aware run context and agent operations

Flapstack SHALL include only explicitly selected nodes or explicitly bounded link
expansions in agent context and SHALL preserve existing scope/approval/audit gates.

#### Scenario: Selected note links to ten other notes

- **WHEN** link expansion is not enabled
- **THEN** only the selected note enters the run manifest

#### Scenario: Agent writes a custom note

- **WHEN** an approved scoped agent supplies exact note identity and version
- **THEN** the write uses path/content safety, conflict checks, backup, audit, and graph invalidation

### Requirement: Portable and recoverable interoperable vault

Flapstack SHALL export and restore nodes, safe attachments, stable metadata, and
backups while rebuilding derived graph indexes and excluding unsafe internals.

#### Scenario: Vault is restored to another machine

- **WHEN** the user maps the project and vault root during dry-run import
- **THEN** Markdown opens in Flapstack and Obsidian with stable node/link identity and rebuilt indexes

#### Scenario: `.obsidian` contains plugin state

- **WHEN** Flapstack exports or injects project knowledge
- **THEN** `.obsidian` content remains preserved on disk but excluded by default

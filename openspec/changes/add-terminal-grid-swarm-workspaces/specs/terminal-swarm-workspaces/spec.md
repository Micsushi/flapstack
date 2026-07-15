## ADDED Requirements

### Requirement: Existing-object grid composition

Flapstack SHALL compose grid panes from existing chats, terminals, runs, agents,
worktrees, and inspection surfaces without creating duplicate work identities.

#### Scenario: User adds an agent chat to a grid

- **WHEN** that chat is controlled in another window
- **THEN** the new pane is read-only until ownership is explicitly moved

### Requirement: Durable bounded grid layouts

Flapstack SHALL save, restore, resize, tab, and repair grid layouts with bounded
resource use and independent stale-pane handling.

#### Scenario: One worktree is missing after restart

- **WHEN** the grid restores
- **THEN** other panes open and the missing pane offers explicit repair/removal

### Requirement: Truthful fleet and lineage projection

Flapstack SHALL show exact orchestration, agent, runtime, task-path, lineage,
activity, budget, and terminal state from authoritative services.

#### Scenario: Agent becomes uncertain after restart

- **WHEN** durable runtime reconciliation cannot prove terminal state
- **THEN** the grid shows uncertain and offers no false resume/replay

### Requirement: Bounded group control

Flapstack SHALL apply group pause/resume/cancel/steer only to an exact reviewed
selection through existing permissions, approval, audit, and cascade services.

#### Scenario: Group cancel partially fails

- **WHEN** some selected agents cannot cancel
- **THEN** each result remains visible and successful siblings are not rolled back

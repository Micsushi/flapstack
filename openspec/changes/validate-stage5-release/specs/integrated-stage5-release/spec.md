## ADDED Requirements

### Requirement: Exact-candidate evidence ledger

Flapstack SHALL bind every required Stage 5 acceptance row to one exact source
SHA, build/profile, environment, and direct evidence record.

#### Scenario: Evidence comes from an older SHA

- **WHEN** code affecting the row changed afterward
- **THEN** the row reopens until current-candidate evidence exists

### Requirement: Clean and Stage 4 upgrade integrity

Flapstack SHALL preserve supported Stage 4 data/authority/history while clean
install and upgrade reach the complete Stage 5 product.

#### Scenario: Upgrade encounters legacy inline personality

- **WHEN** Stage 5 opens it
- **THEN** history remains readable and conversion is explicit/non-destructive

### Requirement: Integrated Stage 5 workflow

Flapstack SHALL exercise onboarding, profile/personality, orchestration/runtime,
workspace/grid, visual context, usage, mobile, Obsidian-compatible project
knowledge, and recovery in one project.

#### Scenario: Reviewer child is monitored on mobile

- **WHEN** it uses shared personality and visual artifact context
- **THEN** profile, authority, Runtime, lineage, usage, mobile, and audit agree

#### Scenario: Project knowledge is edited in Obsidian

- **WHEN** the same note is linked, selected for a run, exported, and reopened
- **THEN** Markdown, graph identity, context provenance, Git state, and recovery agree

### Requirement: Release-quality security, usability, and performance

Flapstack SHALL pass independent security/privacy, accessibility/usability,
performance, artifact, and platform review without unresolved release blockers.

#### Scenario: Review finds a P1 data-loss path

- **WHEN** candidate is otherwise green
- **THEN** release blocks, fix lands, and affected evidence reruns

### Requirement: Explicit release authority and limitations

Flapstack SHALL separate verified readiness from merge, push, tag, publication,
or unsupported-platform claims.

#### Scenario: Candidate passes locally

- **WHEN** no explicit publication authorization exists
- **THEN** artifacts remain local and no remote release action occurs

## ADDED Requirements

### Requirement: First-run work-style guide

Flapstack SHALL offer a short tutorial and questionnaire on first install before
applying optional feature visibility defaults.

#### Scenario: Lightweight user chooses one-to-two-agent work

- **WHEN** the user selects a focused work style and reviews the result
- **THEN** core work remains visible while optional advanced surfaces start hidden

### Requirement: Visibility does not disable capability

Flapstack SHALL treat feature visibility independently from data, APIs, MCP,
permissions, safety, background contracts, and valid direct entry points.

#### Scenario: Plan view is hidden

- **WHEN** Plan/Kanban navigation is hidden by a preset
- **THEN** its data remains intact and Settings can reveal the surface without migration

### Requirement: Reviewable and reversible setup

Flapstack SHALL preview exact visibility changes before first apply or rerun and
SHALL preserve existing data and explicit authority.

#### Scenario: Existing user reruns setup

- **WHEN** answers imply different visibility
- **THEN** Flapstack shows a diff and applies only after confirmation

### Requirement: Reusable feature explanations

Flapstack SHALL provide one versioned concise explanation for every major
feature across onboarding, Settings, and contextual help.

#### Scenario: User asks what orchestration does

- **WHEN** the user opens its help affordance
- **THEN** the same current explanation describes purpose, prerequisites, risk, and enable route

### Requirement: Discoverable visibility controls

Flapstack SHALL expose every optional surface in searchable Settings regardless
of whether its normal navigation is visible.

#### Scenario: Hidden feature is searched

- **WHEN** the user searches Settings for the hidden feature
- **THEN** its visibility control and explanation remain reachable

## ADDED Requirements

### Requirement: Short main-page product tour

Flapstack SHALL provide a versioned tour of the existing main-page workflow
using no more than eight concise anchored steps.

#### Scenario: User advances through the tour

- **WHEN** the user selects Next
- **THEN** focus and the coachmark move to the next available anchor

### Requirement: One-time normal packaged launch

Flapstack SHALL automatically start an incomplete tour version once for a new
normal packaged profile and SHALL persist completion or dismissal.

#### Scenario: Completed user restarts Flapstack

- **WHEN** the current tour version is already completed
- **THEN** the tour does not open automatically

### Requirement: Development and test suppression

Flapstack SHALL not automatically start the product tour in development, test,
or fixture profiles.

#### Scenario: Developer reloads the renderer

- **WHEN** the application is not a normal packaged profile
- **THEN** the tour remains closed without writing completion state

### Requirement: Settings rerun

Flapstack SHALL expose a searchable Settings action that starts the tour
manually without clearing unrelated data.

#### Scenario: User reruns the tutorial

- **WHEN** the user selects Run tutorial in Settings
- **THEN** the current tour begins and existing projects/chats remain unchanged

### Requirement: Accessible resilient coachmarks

Flapstack SHALL support keyboard navigation, Escape, focus restoration,
scroll-into-view, and safe skipping of unavailable anchors.

#### Scenario: Responsive layout hides an anchor

- **WHEN** the current step's anchor is unavailable
- **THEN** Flapstack advances to the next available step or exits cleanly

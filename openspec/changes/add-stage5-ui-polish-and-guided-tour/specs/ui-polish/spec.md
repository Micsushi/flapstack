## ADDED Requirements

### Requirement: Useful projectless application shell

Flapstack SHALL retain its normal application shell when no project is selected
and SHALL provide clear actions to open, clone, or revisit work.

#### Scenario: User starts without a selected project

- **WHEN** provider setup is complete and no project is selected
- **THEN** the sidebar and settings remain available beside an in-shell home state

### Requirement: Restrained chat navigation motion

Flapstack SHALL render existing chat titles and conversation content without
replaying generated-title or scale/slide entrance motion.

#### Scenario: User switches between existing chats

- **WHEN** the user selects another stored chat
- **THEN** its title and content appear immediately without left-to-right typing

#### Scenario: User prefers reduced motion

- **WHEN** the operating system requests reduced motion
- **THEN** chat navigation and planning status use static presentation

### Requirement: Stable planning status

Flapstack SHALL show professional planning phrases from a stable sequence at a
readable cadence.

#### Scenario: Streaming rerenders repeatedly

- **WHEN** one active planning tool rerenders
- **THEN** its phrase does not change before the configured interval

### Requirement: Usable sidebar geometry

Flapstack SHALL provide a useful default sidebar width, preserve explicit user
widths, and reserve closing for explicit controls.

#### Scenario: User clicks the resize divider

- **WHEN** pointer movement does not cross the resize threshold
- **THEN** the sidebar remains open

### Requirement: Three explicit chat modes

Flapstack SHALL expose Write, Plan, and Review through one keyboard- and
pointer-operable segmented control.

#### Scenario: Legacy Read mode is loaded

- **WHEN** stored mode is `read`
- **THEN** Flapstack normalizes it to Review with read-only permissions

### Requirement: Shared header alignment

Flapstack SHALL align the title, folder icon, actions, project chip, and provider
chip through shared geometry that remains valid across supported platforms and
display scaling.

#### Scenario: Header renders on Windows at 150 percent scaling

- **WHEN** a chat with project and provider chips is active
- **THEN** all controls remain centered, legible, and clickable

### Requirement: Truthful native application launching

Flapstack SHALL list only platform-valid installed launch targets and SHALL
always provide a correctly named native folder action.

#### Scenario: Open In renders on Windows

- **WHEN** Finder, Xcode, and iTerm are not valid Windows applications
- **THEN** they are absent and the native action is labeled Open folder

#### Scenario: Preferred application is unavailable

- **WHEN** a stored launch preference cannot be resolved
- **THEN** Flapstack falls back to the native folder action without failing

### Requirement: Exact notification navigation

Flapstack SHALL retain and consume completed-chat notification targets until the
main renderer opens the exact project and conversation.

#### Scenario: User clicks a cross-project notification during renderer load

- **WHEN** the target project is not selected and renderer state is hydrating
- **THEN** Flapstack focuses, selects the project, and opens the target chat once

### Requirement: Current model defaults preserve explicit history

Flapstack SHALL use Claude Opus 5 and OpenAI GPT-5.6 Sol for applicable new
chats without rewriting explicitly stored older model IDs.

#### Scenario: Existing GPT-5.5 chat is reopened

- **WHEN** its stored model is `gpt-5.5`
- **THEN** Flapstack keeps that model rather than replacing it with the default

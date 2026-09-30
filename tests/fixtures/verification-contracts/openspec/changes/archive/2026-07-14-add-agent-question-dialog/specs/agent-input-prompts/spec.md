## ADDED Requirements

### Requirement: Focused structured agent input

The system SHALL present a focused in-app dialog when an active agent run emits a
supported structured request for user input.

#### Scenario: Active chat requests a single answer

- **WHEN** the active run requests a single-select answer with labeled options
- **THEN** Flapstack opens a dialog using radio semantics
- **AND** allows one listed option or a custom answer
- **AND** submits the result to the originating request

#### Scenario: Active chat requests multiple answers

- **WHEN** the active run requests a multi-select answer
- **THEN** Flapstack uses checkbox semantics
- **AND** validates the selection before submission

#### Scenario: Background chat requests input

- **WHEN** a non-active run requests input
- **THEN** Flapstack does not steal focus
- **AND** shows a needs-input notification and a reopenable pending indicator

### Requirement: Free-text answering mode

The system SHALL let the user move a pending structured question set into the normal
chat composer without losing the questions.

#### Scenario: User chooses normal chat answering

- **WHEN** the user selects `Answer in chat`
- **THEN** Flapstack closes the dialog
- **AND** presents the numbered question list with the normal composer
- **AND** keeps the structured dialog reopenable until an answer is sent or the run ends

### Requirement: Honest continuation behavior

The system SHALL resume the originating run through the harness-native input mechanism
when supported and disclose when it must continue through a normal user turn instead.

#### Scenario: Harness supports native structured input

- **WHEN** the user submits an answer before the request is cancelled
- **THEN** Flapstack returns it to the same pending run
- **AND** the agent continues from its paused state

#### Scenario: Harness lacks native structured input

- **WHEN** the selected harness cannot pause for a structured response
- **THEN** Flapstack sends the answer as a normal continuation message
- **AND** records that fallback in the visible run history

### Requirement: Provider-independent question surface

The system SHALL expose the same structured question experience across every registered
harness without coupling renderer behavior to individual provider or model names.

#### Scenario: Models share a harness family

- **WHEN** multiple providers or models use the same harness adapter
- **THEN** Flapstack implements question translation once for that harness family
- **AND** every compatible model receives the shared question experience

#### Scenario: Harness supports custom tools but no native question event

- **WHEN** a harness can execute a Flapstack-defined tool but has no native question event
- **THEN** Flapstack exposes its shared structured-question tool to that harness
- **AND** routes the tool request through the same dialog and result contract

#### Scenario: Future harness registers input capability

- **WHEN** a new harness declares native, injected-tool, or continuation input capability
- **THEN** Flapstack uses the existing question UI without provider-specific renderer code

### Requirement: Durable question history

The system SHALL preserve structured questions and their visible answers in chat history.

#### Scenario: User revisits an answered request

- **WHEN** the user reopens the chat after answering
- **THEN** the transcript shows the question set and submitted answers
- **AND** does not reopen the completed dialog

## ADDED Requirements

### Requirement: Independent Model Tuning Control

The system SHALL render provider/model selection and model run tuning as adjacent, independently operable controls wherever a user configures a new or existing chat. The closed tuning control SHALL display the effective effort or reasoning level without requiring the user to open it.

#### Scenario: Inspect active effort at a glance

- **WHEN** the selected model supports effort or reasoning-level selection
- **THEN** the input bar shows the effective selection on the closed tuning control beside the model control

#### Scenario: Change effort independently

- **WHEN** the user opens the tuning control and selects another supported effort or reasoning level
- **THEN** the system applies that selection without opening or changing the provider/model picker

#### Scenario: Model picker stays focused

- **WHEN** the user opens the provider/model picker
- **THEN** effort, reasoning-level, and fast-mode controls are not mixed into that picker

#### Scenario: Provider has no model tuning

- **WHEN** the selected provider and model expose no supported effort, reasoning, or fast-mode settings
- **THEN** the system hides the tuning control instead of showing an empty or ineffective menu

### Requirement: Capability-Gated Fast Mode

The system SHALL expose fast mode only when the selected model explicitly declares fast-mode support. The tuning control SHALL visibly indicate when fast mode is enabled.

#### Scenario: Supported model enables fast mode

- **WHEN** the selected model declares fast-mode support and the user enables fast mode
- **THEN** the system applies fast mode and shows its enabled state on the closed tuning control

#### Scenario: Unsupported model hides fast mode

- **WHEN** the selected model does not declare fast-mode support
- **THEN** the tuning menu does not show a fast-mode switch

#### Scenario: Switch from supported to unsupported model

- **WHEN** fast mode is enabled and the user selects a model that does not support it
- **THEN** the system disables fast mode automatically and does not send a fast-mode request for that model

### Requirement: Consistent New And Existing Chat Tuning

The system SHALL provide the same model tuning behavior in the new-chat form and the active-chat input bar while retaining the existing last-selected and per-chat persistence scopes.

#### Scenario: Configure a new chat

- **WHEN** the user selects effort or fast mode before creating a chat
- **THEN** the created chat starts with those supported tuning values

#### Scenario: Tune an existing chat

- **WHEN** the user changes effort or fast mode in an existing chat
- **THEN** the system persists those supported values for that chat and uses them on subsequent runs

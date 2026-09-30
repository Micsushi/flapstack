## ADDED Requirements

### Requirement: Open Active Workspace In An External Editor

The system SHALL expose an Open In control in the shared desktop conversation header for every agent provider. The control SHALL target the active conversation's resolved local worktree or project folder and SHALL use the existing preferred-editor action and editor menu.

#### Scenario: Open a local conversation folder

- **WHEN** a user activates a conversation with a resolved local folder and selects the header's primary Open In action
- **THEN** the system opens that folder in the user's preferred editor

#### Scenario: Choose another editor

- **WHEN** a user opens the header control's menu and selects an available editor
- **THEN** the system opens the active conversation folder in that editor and preserves the existing preferred-editor behavior

#### Scenario: Provider-independent availability

- **WHEN** a local conversation is rendered for any supported agent provider
- **THEN** the same shared Open In control is available without provider-specific behavior

#### Scenario: No local folder

- **WHEN** the active conversation has no resolved local folder
- **THEN** the Open In control is disabled and does not attempt to launch an editor

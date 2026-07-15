## ADDED Requirements

### Requirement: Single Runtime request authority

Flapstack SHALL route provider-native coordination requests through Agent Runtime
and SHALL NOT let orchestration create a second provider client/parser.

#### Scenario: Workflow selects Codex V2 coordination

- **WHEN** the resolved Runtime supports required protocol version
- **THEN** F11 sends the request and F3 records only coordination identity/state

### Requirement: Structured-output propagation

Flapstack SHALL forward required workflow output schemas through compatible
Runtime options and validate final durable output before barrier completion.

#### Scenario: Adapter lacks required structured output

- **WHEN** workflow step declares a required schema
- **THEN** launch blocks before worker claim and no fallback prompt is invented

### Requirement: Truthful pause and resume

Flapstack SHALL expose pause/resume only for runs whose resolved Runtime supports
the operation and SHALL preserve exact partial results.

#### Scenario: Mixed group pause includes unsupported agent

- **WHEN** group control runs
- **THEN** supported targets pause and unsupported target remains unchanged with reason

### Requirement: Nonduplicated ordered activity and recovery

Flapstack SHALL preserve F11 activity authority while adding F3 workflow events
by reference and SHALL recover without replaying completed or separately claimed work.

#### Scenario: App restarts after worker launch

- **WHEN** durable run is already terminal
- **THEN** F3 projects terminal state and never reserves/launches it again

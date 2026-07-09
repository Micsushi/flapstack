## ADDED Requirements

### Requirement: Usage Sampling

The system SHALL poll configured usage providers on a main-process interval
scheduler with a default 5-minute, user-configurable cadence, persist samples and
billing cycles to SQLite, and SHALL show an honest not-configured or auth-failed
state rather than a silent zero.

#### Scenario: Configured provider is polled

- **WHEN** a provider is configured with a valid key and the poll interval elapses
- **THEN** a usage sample is persisted to SQLite tagged with its provider

#### Scenario: Provider not configured

- **WHEN** a provider has no credentials
- **THEN** the system reports a clear not-configured state
- **AND** records no fabricated zero sample

### Requirement: Provider Coverage

The system SHALL support usage tracking for Anthropic, Codex, and Cursor, and
SHALL store each source's raw payload alongside the normalized quota/spend shape
with a tag identifying which source answered.

#### Scenario: Cursor usage via local token

- **WHEN** Cursor is installed and logged in locally
- **THEN** the Cursor provider reads the local access token and fetches usage from
  the internal endpoint (source 1)
- **AND** the sample is stored tagged with source `internal` plus its raw payload

#### Scenario: Lower Cursor sources are stubbed

- **WHEN** source 1 is unavailable
- **THEN** the fallback chain exposes admin-API and CLI slots
- **AND** those slots report a clearly-marked unimplemented state this stage

### Requirement: Threshold Alerts

The system SHALL fire a desktop notification when a configured usage threshold is
crossed, debounced so that a single crossing produces exactly one alert.

#### Scenario: Threshold crossed once

- **WHEN** usage crosses a configured threshold
- **THEN** exactly one desktop notification is fired
- **AND** the alert re-arms only after usage resets below the threshold

### Requirement: Usage Dashboard

The system SHALL present usage in a top-level Usage tab showing per-provider
current and historical usage with distinct empty, loading, and error states in
both light and dark themes.

#### Scenario: Dashboard before any samples exist

- **WHEN** the Usage tab is opened before any samples are collected
- **THEN** an empty/loading state renders without error

#### Scenario: Dashboard with live data

- **WHEN** samples exist for configured providers
- **THEN** the dashboard shows current usage and historical cycles per provider

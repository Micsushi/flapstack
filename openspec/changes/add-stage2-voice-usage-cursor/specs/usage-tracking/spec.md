## ADDED Requirements

### Requirement: Shared Usage Engine

The system SHALL provide a shared TypeScript usage engine that can run in both
the Flapstack main process and a background usage daemon, with a default
5-minute user-configurable polling cadence.

#### Scenario: Engine runs in daemon mode

- **WHEN** the background daemon is enabled and Flapstack UI is closed
- **THEN** configured usage providers are polled on the configured cadence
- **AND** samples are persisted to the shared SQLite usage store

#### Scenario: Daemon lifecycle on desktop platforms

- **WHEN** the user enables background usage on macOS, Windows, or Linux
- **THEN** Flapstack installs the native per-user service for that platform
- **AND** the closed-app daemon reads credentials from the same OS user secret store as the app

#### Scenario: Engine runs in app mode

- **WHEN** the Flapstack app requests manual refresh or startup reconciliation
- **THEN** the same provider engine is used
- **AND** duplicate samples from daemon/app overlap are not double-counted

### Requirement: Shared Usage Store

The system SHALL persist usage samples, cycles, provider states, alert events,
raw provider payloads, cost-quality labels, and daemon heartbeat/status data in
a shared SQLite store that supports daemon writes and app reads.

#### Scenario: Daemon writes while app is closed

- **WHEN** the daemon records samples while the app is closed
- **THEN** opening Flapstack shows those samples in the Usage dashboard

#### Scenario: Provider data is incomplete

- **WHEN** a provider exposes only current aggregate or run-level data
- **THEN** the stored sample is labeled with the correct source and cost quality
- **AND** missing historical detail is not fabricated as zero usage

#### Scenario: Repeated quota polls retain history

- **WHEN** app and daemon polls observe the same quota window over time
- **THEN** overlap within one captured minute is deduplicated
- **AND** observations from later minutes remain distinct historical samples

### Requirement: Startup Catch-up

The system SHALL reconcile latest provider usage when Flapstack starts and when
the user manually refreshes usage data.

#### Scenario: Provider supports historical reconciliation

- **WHEN** Flapstack starts after usage changed while app and daemon were off
- **THEN** the app fetches provider data since the latest known sample
- **AND** persists recovered samples or cycles with source `startup-reconcile`

#### Scenario: Provider lacks historical reconciliation

- **WHEN** Flapstack starts and a provider only exposes current aggregate or
  run-level data
- **THEN** the app records the latest available data
- **AND** shows an honest gap or limited-history state

### Requirement: Provider Coverage

The system SHALL support usage tracking for Codex/OpenAI, Claude/Anthropic,
Cursor, OpenRouter, and NanoGPT, including general account usage where provider
APIs and credentials allow it, not only usage from Flapstack-launched runs.

#### Scenario: Codex/OpenAI usage is recorded

- **WHEN** OpenAI/Codex credentials allow usage or cost API access
- **THEN** usage and cost data are stored with provider/account tags
- **AND** raw payloads are preserved for drift debugging

#### Scenario: Personal Codex quota is recorded

- **WHEN** a local Codex OAuth session exposes subscription rate-limit windows
- **THEN** each quota window is stored as a distinct subscription metric
- **AND** organization API-spend samples remain distinct when both sources exist

#### Scenario: Claude/Anthropic usage is recorded

- **WHEN** Anthropic credentials allow Admin Usage and Cost API access
- **THEN** workspace/account usage and cost data are stored
- **AND** limited local-credential paths are labeled honestly when admin API
  access is unavailable

#### Scenario: Personal Claude quota is recorded

- **WHEN** a local Claude Code OAuth session exposes subscription quota windows
- **THEN** enabled windows are stored as distinct subscription metrics
- **AND** the private local-session source is labeled honestly

#### Scenario: Cursor usage via local token

- **WHEN** Cursor is installed and logged in locally
- **THEN** the Cursor provider reads the local access token and fetches usage from
  the internal endpoint (source 1)
- **AND** the sample is stored tagged with source `internal` plus its raw payload
- **AND** plan, credit-grant, Stripe-balance, request, and model details are
  preserved when those source-1 responses expose them

#### Scenario: Lower Cursor sources are stubbed

- **WHEN** Cursor source 1 is unavailable
- **THEN** the fallback chain exposes admin-API and CLI slots
- **AND** those slots report a clearly-marked unimplemented state this stage

#### Scenario: OpenRouter usage is recorded

- **WHEN** OpenRouter is configured and a direct API run returns usage, cost, or
  generation metadata
- **THEN** the sample is stored tagged with provider `openrouter`
- **AND** generation IDs are preserved for later generation-stat reconciliation
- **AND** the official upstream generation ID is captured from the OpenRouter
  response before the OpenCode sidecar can discard provider headers
- **AND** if exact cost is absent, the sample is marked as an estimate derived
  from normalized token counts and model pricing metadata

#### Scenario: NanoGPT usage is recorded

- **WHEN** NanoGPT is configured and a direct API run returns usage or cost
  metadata
- **THEN** the sample is stored tagged with provider `nanogpt`
- **AND** raw provider payloads are preserved for drift debugging
- **AND** if exact cost is absent, the sample is marked as an estimate derived
  from normalized token counts and model pricing metadata

### Requirement: Background Alerts

The system SHALL evaluate usage thresholds in the background daemon and send
Discord webhook alerts while the Flapstack UI is closed.

#### Scenario: Quota threshold is crossed

- **WHEN** a subscription/quota provider crosses a configured percent-used or
  reset-window threshold
- **THEN** the daemon sends exactly one configured alert
- **AND** the alert re-arms only after usage resets below the threshold band

#### Scenario: API spend threshold is crossed

- **WHEN** an API-spend provider crosses a configured dollar, spend-rate, or
  spike threshold
- **THEN** the daemon sends a Discord webhook alert
- **AND** exact and estimated spend are labeled distinctly in the alert body

#### Scenario: Discord webhook fails

- **WHEN** Discord delivery fails
- **THEN** the failure is persisted as a usage alert event
- **AND** the webhook URL is not logged or exposed in raw error text

### Requirement: Usage Dashboard And Settings

The system SHALL present usage in a top-level Usage tab showing per-provider
current and historical usage, costs, token counts, exact/estimated labels,
daemon health, and distinct empty, loading, limited, and error states in both
light and dark themes.

#### Scenario: Dashboard before any samples exist

- **WHEN** the Usage tab is opened before any samples are collected
- **THEN** an empty/loading state renders without error

#### Scenario: Dashboard with daemon data

- **WHEN** daemon-written samples exist
- **THEN** the dashboard shows current usage and historical cycles per provider
- **AND** daemon heartbeat, last poll, last alert, and error state are visible
- **AND** historical quota, cost, and token series are graphed without fabricating gaps

#### Scenario: Dashboard separates general and Flapstack-only usage

- **WHEN** the user opens the All provider view
- **THEN** the dashboard shows every provider-visible account/quota source, including usage outside Flapstack
- **WHEN** the user opens one provider
- **THEN** they can switch between all provider-visible usage and samples created by Flapstack runs only
- **AND** both current cards and usage/cost graphs follow that scope

#### Scenario: Provider history matches OnWatch graph behavior

- **WHEN** the user opens a provider with historical samples
- **THEN** separate Usage Over Time and Cost Over Time graphs are visible
- **AND** one shared control row offers Cumulative and Per Period modes
- **AND** the shared controls offer 1h, 6h, 24h, 7d, 30d, and All ranges with 7d selected by default
- **AND** multi-series graph legends can hide or show individual series
- **AND** hovering or focusing a point exposes its series, value, and timestamp
- **AND** quota cards and quota-history series use OnWatch's exact healthy (<50%), warning (>=50%), danger (>=80%), and critical (>=95%) percent-used states and theme colors
- **AND** an existing local OnWatch store seeds the complete Codex and Claude snapshot range before Flapstack continues collecting new samples
- **AND** missing buckets remain absent instead of being fabricated as zero usage

#### Scenario: Dashboard keeps routine usage detail minimal

- **WHEN** current usage is available
- **THEN** quota cards prioritize the metric name, percent used, progress, and reset date
- **AND** spend-only cards prioritize cost with token count only when available
- **AND** missing metrics and technical source identifiers are omitted from the default cards

#### Scenario: Settings configure daemon and alerts

- **WHEN** the user opens usage settings
- **THEN** they can enable/disable providers, configure credentials, daemon
  state, cadence, thresholds, and Discord webhook delivery without editing files

## ADDED Requirements

### Requirement: Deterministic Usage Collection

The system MUST collect usage through one normalization and persistence
contract across app polling, background daemon polling, startup reconciliation,
manual refresh, and provider-run telemetry.

#### Scenario: App and daemon overlap

- **WHEN** app and daemon collection observe the same provider metric in the
  same capture window
- **THEN** the stable identity prevents double counting
- **AND** a later observation remains available as historical data

#### Scenario: One provider hangs or fails

- **WHEN** a provider request or response body exceeds its deadline or fails
- **THEN** that provider records a bounded unavailable/error state
- **AND** later providers continue polling
- **AND** the failure cannot render as empty or zero usage

#### Scenario: App restarts after a collection gap

- **WHEN** Flapstack starts after app and daemon collection were both stopped
- **THEN** historical providers reconcile from the latest durable cursor
- **AND** limited providers expose an unrecoverable gap without invented samples

### Requirement: Durable Usage Provenance

The system MUST preserve stable identities, useful token and model metadata,
sanitized raw provider evidence, and monotonic cost quality across retries and
reconciliation.

#### Scenario: Strong and weak cost data collide

- **WHEN** exact or provider-reported cost and estimated or unknown cost refer
  to the same usage event
- **THEN** weaker cost cannot replace stronger cost
- **AND** non-conflicting token, request, model, and sanitized raw metadata may
  still fill missing fields

#### Scenario: Exact provider cost is unavailable

- **WHEN** a provider exposes tokens but no verified price or exact cost
- **THEN** token usage persists
- **AND** cost is labeled estimated only with verified pricing metadata
- **AND** otherwise cost remains unknown rather than zero

#### Scenario: Shared database is busy or corrupt

- **WHEN** app reads overlap daemon writes or a database operation cannot safely
  complete
- **THEN** bounded WAL, busy-timeout, and retry policy is applied
- **AND** unresolved failure is surfaced and no sample is reported as persisted

### Requirement: Safe Closed-App Daemon Lifecycle

The system MUST install, run, disable, uninstall, and recover the supported
per-user daemon without duplicate schedulers, orphan services, or renderer-only
credential dependencies.

#### Scenario: Daemon collects while app is closed

- **WHEN** the user enables the daemon and closes Flapstack for at least one
  configured cadence
- **THEN** exactly one scheduler records a fresh heartbeat and sample
- **AND** reopening the app shows the durable result

#### Scenario: Credential persistence is unavailable

- **WHEN** the OS user secret store cannot persist a credential needed by the
  closed-app daemon
- **THEN** configuration fails with an actionable safe-storage state
- **AND** the UI does not claim a session-only renderer value will power the
  daemon
- **AND** the secret is absent from argv, logs, screenshots, and plaintext files

#### Scenario: Daemon is disabled or uninstalled

- **WHEN** the user disables or uninstalls background collection
- **THEN** polling and heartbeat advancement stop
- **AND** no duplicate process, scheduled task, unit, or wrapper remains

### Requirement: Reliable Background Alerts

The system MUST persist threshold evaluation and Discord delivery outcomes so
failed delivery retries without duplicate successful alerts or leaked webhook
credentials.

#### Scenario: Delivery fails then recovers

- **WHEN** a crossed threshold receives a failed Discord response
- **THEN** the failed event is persisted and the threshold remains armed
- **AND** a later daemon tick retries
- **AND** one successful delivery disarms the threshold until it re-arms

#### Scenario: Per-run spend crosses a threshold

- **WHEN** completed provider-run usage crosses a configured spend threshold
- **THEN** the shared alert runner evaluates the normalized exact or estimated
  sample once
- **AND** the alert states its cost quality

### Requirement: Truthful Usage Exit Evidence

The system MUST expose current and historical Usage data with honest state and
complete the required exit matrix against exact builds and environments.

#### Scenario: User inspects Usage

- **WHEN** current, historical, alert, or provider-state queries load, fail, or
  have limited data
- **THEN** provider/account filters, paging, charts, cost quality, and daemon
  status match durable records
- **AND** missing buckets remain absent
- **AND** loading, empty, limited, error, exact, estimated, and unknown states
  remain distinguishable

#### Scenario: Evidence is unavailable

- **WHEN** a required provider credential, OS, package target, or service
  environment is unavailable
- **THEN** the corresponding evidence row remains open with the exact blocker
- **AND** fixture or cross-platform inference cannot mark it passed

#### Scenario: Usage exit is declared complete

- **WHEN** S3-F14 is marked complete
- **THEN** focused tests, daemon smoke, Node 22 `npm run check`, strict OpenSpec,
  required verified-dev rows, and required package/platform rows have passed
- **AND** the evidence record identifies exact SHA, executable/profile,
  database, provider versions, sanitized artifacts, and remaining limitations

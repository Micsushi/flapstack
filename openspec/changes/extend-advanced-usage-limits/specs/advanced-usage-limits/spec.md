## ADDED Requirements

### Requirement: Durable multi-scope attribution

Flapstack SHALL snapshot available provider, account, harness, project, task,
chat, automation, orchestration, model, and run attribution on usage facts.

#### Scenario: Task is renamed or archived

- **WHEN** historical usage is queried after its task changes
- **THEN** the original attribution remains available with current navigation state separately

### Requirement: Reconciled rollups without double counting

Flapstack SHALL distinguish provider-account totals from Flapstack-run samples
and SHALL apply explicit dedupe/reconciliation rules before aggregation.

#### Scenario: Provider total overlaps run samples

- **WHEN** both sources cover the same time window
- **THEN** the All view does not add them as independent spend and exposes source provenance

### Requirement: Honest headroom and forecast

Flapstack SHALL calculate remaining quota/budget, burn rate, forecast, and
anomalies only when source coverage supports them and SHALL expose quality.

#### Scenario: Sparse estimated history

- **WHEN** samples do not meet coverage requirements
- **THEN** forecast is unavailable or ranged and never shown as an exact projection

### Requirement: Scoped budget policy

Flapstack SHALL support soft alerts and hard launch/run stops for controllable
global, provider/account, project, task, automation, and orchestration scopes.

#### Scenario: Project hard budget is exhausted

- **WHEN** a new Flapstack-controlled run resolves inside that project
- **THEN** launch stops before provider work and shows budget, source, reset, and override path

### Requirement: Advanced usage exploration

Flapstack SHALL filter and compare usage by scope, provider/account, harness,
model, source class, quality, and time range with drill-down to supporting facts.

#### Scenario: User drills into an estimate

- **WHEN** a chart or table value includes estimated cost
- **THEN** the detail identifies estimate inputs, pricing version, samples, and unavailable exact data

### Requirement: Daemon alerts and redacted export

Flapstack SHALL evaluate advanced thresholds while the app is closed and export
selected normalized usage without credentials or unredacted provider payloads.

#### Scenario: Daemon detects a project spend spike

- **WHEN** enough attributed samples produce a configured spike
- **THEN** the daemon records one debounced alert with scope and quality and sends configured notification safely

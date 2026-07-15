## ADDED Requirements

### Requirement: Optional secure organization credentials

Flapstack SHALL keep organization polling disabled until an explicitly supplied
write-only credential validates for one exact provider organization.

#### Scenario: Admin credential is removed

- **WHEN** the user deletes it
- **THEN** polling stops, plaintext is absent, and historical samples remain

### Requirement: Exact organization identity and provenance

Flapstack SHALL label every organization sample with provider, organization,
account, endpoint, window, freshness, currency, coverage, and truth class.

#### Scenario: Provider omits cost

- **WHEN** only usage is reported
- **THEN** cost remains unknown unless a separately labeled estimate is available

### Requirement: No double-counted reconciliation

Flapstack SHALL keep provider organization totals distinct from Flapstack run
samples and SHALL explain overlap/coverage without silently summing both.

#### Scenario: Run appears inside organization total

- **WHEN** both datasets cover it
- **THEN** dashboard compares them and does not add the run cost twice

### Requirement: Resilient closed-app polling and alerts

Flapstack SHALL poll organization sources through the local daemon with bounded
cursors/rate limits and evaluate scoped budgets/alerts with freshness truth.

#### Scenario: Provider rate limits polling

- **WHEN** refresh is deferred
- **THEN** last-known data remains labeled stale and no duplicate alert fires

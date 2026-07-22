# S6-F8 — Organization Usage APIs

### S6-F8-T1 — Lock provider scope, credentials, identity, and provenance

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F8
- Outcome: OpenAI/Anthropic organization endpoints, credential needs, sample fields, truth classes, and unavailable behavior are explicit.
- Scope: Current official API contract snapshot; scopes; organization/account selection; endpoint/window/cursor/rate limits; currency/coverage; retention; low-value credential test policy; surface keep/remove decision.
- Out of scope: Adapter implementation.
- Acceptance: No Admin key is required for other app use; every unavailable field has honest state; evidence sanitization is defined.
- Verification: Contract/security/product review with provider fixture schema tests.
- Blocked by: accepted S4-F7
- Blocks: S6-F8-T2, S6-F8-T3, S6-F8-T4, S6-F8-T5, S6-F8-T6
- Context: existing optional organization fields, usage provenance, credential service.

### S6-F8-T2 — Implement OpenAI organization usage and cost adapter

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F8
- Outcome: Flapstack polls allowed OpenAI organization data with exact identity, cursors, coverage, and errors.
- Scope: Credential validation; organization/project selection; usage/cost endpoints; pagination/cursors; rate limits; retries; normalization; freshness; diagnostics; fixture capture.
- Out of scope: Anthropic and UI.
- Acceptance: Wrong scope/org fails; pagination dedupes; missing cost remains unknown; logs/errors redact secrets and sensitive raw payloads.
- Verification: Fixture/pagination/rate/retry/auth/redaction/store tests plus low-value sanitized live run.
- Blocked by: S6-F8-T1
- Blocks: S6-F8-T4, S6-F8-T5, S6-F8-T6, S6-F8-T7
- Context: usage provider registry, safe credentials, daemon polling.

### S6-F8-T3 — Implement Anthropic organization usage and cost adapter

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F8
- Outcome: Flapstack polls allowed Anthropic organization data with exact identity, cursors, coverage, and errors.
- Scope: Credential validation; organization/workspace selection where exposed; usage/cost endpoints; pagination/cursors; rate limits; retries; normalization; freshness; diagnostics; fixtures.
- Out of scope: OpenAI and UI.
- Acceptance: Wrong scope/org fails; pagination dedupes; unavailable metrics remain unknown; secrets/raw payloads are redacted.
- Verification: Fixture/pagination/rate/retry/auth/redaction/store tests plus low-value sanitized live run.
- Blocked by: S6-F8-T1
- Blocks: S6-F8-T4, S6-F8-T5, S6-F8-T6, S6-F8-T7
- Context: usage provider registry, safe credentials, daemon polling.

### S6-F8-T4 — Add organization identities, samples, rollups, and reconciliation

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F8
- Outcome: Organization totals remain queryable and comparable without double counting run/provider datasets.
- Scope: Schema/migration; organization/account records; samples; cursors; uniqueness; currency; rollups; coverage; comparison queries; rebuild; retention; rollback.
- Out of scope: Dashboard rendering.
- Acceptance: Reingest idempotent; organization boundaries never mix; rebuild matches raw; provider totals and run samples stay separate.
- Verification: Migration/rollback, dedupe/cursor/currency/time-window/rebuild/reconciliation/property tests.
- Blocked by: S6-F8-T1, S6-F8-T2, S6-F8-T3
- Blocks: S6-F8-T5, S6-F8-T6, S6-F8-T7
- Context: advanced usage samples/rollups/attribution.

### S6-F8-T5 — Add organization Settings, dashboard, budgets, and alerts

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F8
- Outcome: Authorized users configure organizations and inspect totals, coverage, freshness, budgets, and alerts.
- Scope: Alphabetical Settings route; write-only credentials; org/account selector; connection diagnostics; usage dashboard scope; comparison copy; budgets/thresholds; alert destinations; hidden-feature behavior.
- Out of scope: Team authorization/hosted accounts.
- Acceptance: UI never reveals key; org identity and truth class are visible; missing/stale data cannot look exact/current; alerts name scope/coverage.
- Verification: Component/accessibility/search/credential/status/budget/alert tests and live dashboard walkthrough.
- Blocked by: S6-F1-T5, S6-F8-T2, S6-F8-T3, S6-F8-T4
- Blocks: S6-F8-T6, S6-F8-T7
- Context: usage explorer, settings, alerts, onboarding visibility registry.

### S6-F8-T6 — Harden daemon lifecycle, failures, security, and diagnostics

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F8
- Outcome: Closed-app polling handles revocation, rate limits, cursor faults, network loss, and cleanup without secret leakage or duplicate alerts.
- Scope: Daemon credential handoff; schedules/backoff; cursor recovery; auth disable; network; clock; locks; crash/restart; diagnostics; audit; orphan cleanup.
- Out of scope: Provider availability guarantees.
- Acceptance: One poller per profile; revoked credential stops; cursor failure does not duplicate history; stale data/alerts remain truthful.
- Verification: Isolated daemon process tests, fault injection, closed-app smoke, log/filesystem secret scan, restart/cleanup.
- Blocked by: S6-F8-T1, S6-F8-T2, S6-F8-T3, S6-F8-T4, S6-F8-T5
- Blocks: S6-F8-T7
- Context: usage daemon lifecycle, LaunchAgent/service paths.

### S6-F8-T7 — Close organization usage acceptance

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F8
- Outcome: OpenAI and Anthropic organization collection, reconciliation, dashboard, daemon, budgets, and alerts pass truthful evidence.
- Scope: Matrix S6-OU; migrations; credentials; live providers; closed app; rate/failure; export; accessibility; package/platform; docs.
- Out of scope: Requiring credentials unavailable to tester; unavailable rows remain explicit blockers.
- Acceptance: No double count or secret leak; live values map to exact organization/window; unknown/estimated remain labeled.
- Verification: Node 22 npm run check, strict OpenSpec, verified Dev, low-value live credentials, daemon/package/platform matrix.
- Blocked by: S6-F8-T2, S6-F8-T3, S6-F8-T4, S6-F8-T5, S6-F8-T6
- Blocks: S6-F11-T3, S6-F11-T4, S6-F11-T6
- Context: docs/stage6-full-feature-test-matrix.md.

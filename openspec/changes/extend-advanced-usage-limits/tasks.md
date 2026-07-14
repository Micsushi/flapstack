# S4-F7 — Advanced Usage and Limits

### S4-F7-T1 — Add attribution and budget contracts

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F7
- Outcome: Usage facts can retain product-scope attribution and budgets have one typed policy model.
- Scope: Add nullable attribution snapshot fields/table; budget scope/threshold/action/reset DTOs; source-class/dedupe fields; indexes; migrations; fixtures.
- Out of scope: Backfill, queries, alerts, and UI.
- Acceptance: Invalid scope/action combinations fail; prior samples migrate unchanged; unknown attribution remains explicit.
- Verification: `npm test -- advanced-usage-schema` plus supported prior-schema migration fixtures.
- Blocked by: Stage 3 usage exit baseline
- Blocks: S4-F7-T2, S4-F7-T3, S4-F7-T5
- Context: usage samples/cycles/alerts schema, usage types, automation/orchestration stop conditions.

### S4-F7-T2 — Capture and backfill durable attribution

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F7
- Outcome: New run samples snapshot all known scopes and old samples recover safe dimensions.
- Scope: Run/automation/orchestration capture; provider-account source classification; deterministic backfill; rename/archive/delete handling; unknown markers; dedupe migration.
- Out of scope: Rollup queries and dashboard.
- Acceptance: New samples retain original scope; backfill never guesses missing identity; provider totals remain separate from run samples.
- Verification: `npm test -- usage-attribution` with rename, archive, delete, missing row, provider total, automation, and orchestration fixtures.
- Blocked by: S4-F7-T1
- Blocks: S4-F7-T3, S4-F7-T4, S4-F7-T5, S4-F7-T6
- Context: run usage capture, usage store dedupe, chats/tasks schema, automation/orchestration definitions.

### S4-F7-T3 — Implement reconciled multi-scope rollups

- [x] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F7
- Outcome: One query engine returns trustworthy totals and series for every supported scope.
- Scope: Filter/query DTOs; raw-to-rollup aggregation; source-class reconciliation; quality propagation; time buckets; pagination; rebuildable cache; drill-down fact IDs.
- Out of scope: Forecasts, budgets, alerts, and renderer charts.
- Acceptance: Rollups reconcile to raw facts; overlapping provider/run classes do not double count; quality degrades to weakest contributing source.
- Verification: `npm test -- usage-rollups` with golden datasets, overlaps, timezone buckets, pagination, cache rebuild, and sparse facts.
- Blocked by: S4-F7-T1, S4-F7-T2
- Blocks: S4-F7-T4, S4-F7-T5, S4-F7-T6
- Context: usage store queries, cycles, onWatch history import, dashboard series builders.

### S4-F7-T4 — Add headroom, forecast, and anomaly calculations

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F7
- Outcome: Users receive bounded decision support with visible confidence and provenance.
- Scope: Remaining headroom; burn rate; reset-aware pace; forecast/range; coverage threshold; anomaly/spike detection; pricing version; unavailable states.
- Out of scope: Machine-learning services and exact prediction guarantees.
- Acceptance: Sparse/estimated data never yields false exactness; reset windows and pricing versions are included; calculations are deterministic.
- Verification: `npm test -- usage-insights` with exact, estimated, sparse, reset, pricing-change, and anomaly fixtures.
- Blocked by: S4-F7-T2, S4-F7-T3
- Blocks: S4-F7-T5, S4-F7-T6
- Context: usage pricing, alert evaluator, existing pace colours and graph contracts.

### S4-F7-T5 — Enforce scoped budgets and advanced alerts

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F7
- Outcome: Soft alerts and hard stops apply consistently to user and automated runs.
- Scope: Budget CRUD/resolver; precedence; launch preflight; running stop checks; automation/orchestration integration; daemon thresholds; debounce/re-arm; approval-gated override; audit.
- Out of scope: Stopping external provider usage outside Flapstack.
- Acceptance: Hard stops block controlled launches; external usage only alerts; overrides are explicit, bounded, and audited; daemon works with UI closed.
- Verification: `npm test -- usage-budgets` with scope precedence, race, reset, override, automation, orchestration, daemon, and external-only cases.
- Blocked by: S4-F7-T1, S4-F7-T2, S4-F7-T3, S4-F7-T4
- Blocks: S4-F7-T6, S4-F7-T7
- Context: run launch preflight, automation budgets, orchestration stop conditions, alert runner/arm state.

### S4-F7-T6 — Build advanced explorer and redacted export

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F7
- Outcome: Users filter, compare, drill down, configure budgets, and export normalized usage.
- Scope: Scope/account/harness/model/source/quality/time filters; saved view state; chart/table drill-down; insight/quality copy; budget editor; CSV/JSON export; raw redaction; accessibility.
- Out of scope: Hosted analytics and unredacted credential/raw payload export.
- Acceptance: Every aggregate links to facts/provenance; estimates remain labeled; export matches selected filters and contains no secrets.
- Verification: `npm test -- advanced-usage-ui` plus export/redaction, accessibility, and live dashboard walkthrough.
- Blocked by: S4-F7-T2, S4-F7-T3, S4-F7-T4, S4-F7-T5
- Blocks: S4-F7-T7, S4-F8-T3
- Context: usage dashboard, provider tabs, graph components, scoped search/filter patterns.

### S4-F7-T7 — Close advanced usage acceptance

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S4 / Feature S4-F7
- Outcome: Attribution, rollups, budgets, forecasts, alerts, and export pass integrated evidence.
- Scope: Full gate; matrix S4-UL01–S4-UL03; backfill/restart; UI-closed daemon; automation/orchestration hard stop; exact/estimated/unknown; docs; package preview.
- Out of scope: Provider data unavailable in real accounts or unobserved platforms.
- Acceptance: Raw facts reconcile to every tested rollup; budget behavior matches run state; provenance remains truthful.
- Verification: Node 22 `npm run check`, strict OpenSpec, `npm run dev:verify`, daemon/live matrix, and packaged preview.
- Blocked by: S4-F7-T5, S4-F7-T6
- Blocks: Stage S4 integrated exit
- Context: `docs/stage4-full-feature-test-matrix.md` and Stage 4 execution plan.

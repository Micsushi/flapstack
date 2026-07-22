# S6-F9 — Performance and Scale

### S6-F9-T1 — Define datasets, hardware classes, metrics, and budgets

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F9
- Outcome: Every release-critical workflow has a repeatable target and measurement method.
- Scope: Small/medium/large/stress fixtures; macOS/Windows/Linux hardware classes; cold/warm/dev/package; startup/latency/query/stream/CPU/memory/process/cleanup metrics; variance; budgets; support limits.
- Out of scope: Optimization.
- Acceptance: Budgets are measurable and product-relevant; exact environment metadata required; no target depends on unavailable cloud timing alone.
- Verification: Baseline runs repeated at least three times on reference Mac and reviewed methodology.
- Blocked by: accepted Stage 5 exact SHA
- Blocks: S6-F9-T2, S6-F9-T3, S6-F9-T4, S6-F9-T5, S6-F9-T6, S6-F9-T7
- Context: current test fixtures, package profiles, docs/future-release-considerations.md.

### S6-F9-T2 — Build deterministic benchmark, trace, heap, and soak harnesses

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F9
- Outcome: Engineers reproduce metrics locally and in bounded automated gates without user-content leakage.
- Scope: Fixture generators; timers/traces; Electron/process metrics; SQLite stats; heap snapshots; resource counters; report schema; redaction; warmup/repeats; CI subset; long soak runner.
- Out of scope: Feature optimization.
- Acceptance: Same fixture/result schema across platforms; report includes SHA/build/hardware; content/secrets absent; harness overhead measured.
- Verification: Harness self-tests, repeatability/variance study, redaction scan, cross-platform smoke.
- Blocked by: S6-F9-T1
- Blocks: S6-F6-T9, S6-F9-T3, S6-F9-T4, S6-F9-T5, S6-F9-T6, S6-F9-T7, S6-F9-T8
- Context: Vitest, Electron traces, performance APIs, fixture builders.

### S6-F9-T3 — Meet cold/warm startup and first-use budgets

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F9
- Outcome: App shell, database migration/open, services, first project, and first chat become usable within budgets.
- Scope: Startup phases; lazy services; DB open/migrations; renderer boot; initial queries; provider probes; daemon/sidecar deferral; diagnostics; clean/upgrade/package.
- Out of scope: Skipping correctness checks or hiding not-ready services.
- Acceptance: Budgets pass; readiness state remains truthful; failures surface; no background duplicate starts.
- Verification: Harness cold/warm/fresh/upgrade/package runs, startup logs, process/service counts.
- Blocked by: S6-F9-T1, S6-F9-T2
- Blocks: S6-F9-T8, S6-F10-T8
- Context: main/index startup, DB migration, App bootstrap, sidecars.

### S6-F9-T4 — Meet renderer responsiveness and long-history budgets

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F9
- Outcome: Navigation, typing, streaming, timeline, Settings, usage charts, and large chats remain responsive.
- Scope: Render/query granularity; virtualization; message/activity lists; timeline; charts; React Query invalidation; search; input latency; window resize; 10k/100k fixtures.
- Out of scope: Dropping history/activity.
- Acceptance: Budgets pass at supported limits; input remains responsive during stream; scroll/search/timeline stay consistent.
- Verification: Renderer benchmark, performance marks, React profiling, visual/behavior regression, memory after close.
- Blocked by: S6-F1-T6, S6-F9-T1, S6-F9-T2
- Blocks: S6-F9-T8
- Context: transcript stores, activity timeline, usage explorer, Settings search.

### S6-F9-T5 — Meet database, search, migration, and history budgets

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F9
- Outcome: Large local datasets query, migrate, maintain, back up, and recover within budgets.
- Scope: Query/index plans; scoped search; usage/activity/history; migration time; WAL/checkpoint; maintenance; backup/export; concurrent readers/writers; cancellation; integrity.
- Out of scope: Destructive data compaction without recovery.
- Acceptance: Query/migration budgets pass; results complete; lock contention bounded; interrupted maintenance recovers.
- Verification: Large DB fixtures, EXPLAIN/index assertions, migration benchmarks, fault/lock/concurrency/integrity tests.
- Blocked by: S6-F9-T1, S6-F9-T2
- Blocks: S6-F9-T8
- Context: SQLite schema/query services, maintenance, search.

### S6-F9-T6 — Meet agent, terminal, workspace, and orchestration scale budgets

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F9
- Outcome: Supported concurrent agents, terminals, panes, and workflows stream and cancel without unbounded pressure.
- Scope: Process/PTY limits; event backpressure; activity persistence; workspaces/grid; cancellation; scheduling; budgets; 1/2/5/10/50 agent tiers; output flood; cleanup.
- Out of scope: Advertising unsupported unlimited concurrency.
- Acceptance: Limits enforce before exhaustion; events remain ordered/durable; cancel responsive; cleanup returns resources.
- Verification: Deterministic concurrency/output-flood/partial-cancel/restart/soak tests and live supported tier.
- Blocked by: S6-F6-T9, S6-F7-T7, S6-F9-T1, S6-F9-T2
- Blocks: S6-F9-T8
- Context: orchestration scheduler, Runtime activity, terminal manager, grid.

### S6-F9-T7 — Meet background-service and lifecycle resource budgets

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F9
- Outcome: Usage daemon, automation, mobile bridge, watchers, sidecars, notifications, and windows remain bounded over time.
- Scope: Idle/active CPU; memory; timers; listeners; sockets; file watchers; sidecars; app close; sleep/wake; network change; 24h soak; leak diagnostics.
- Out of scope: Hosted monitoring.
- Acceptance: Idle budgets pass; no duplicate worker/listener; sleep/wake recovers; shutdown cleans owned resources.
- Verification: Fake clock plus live soak, process/socket/fd/watcher/heap counts, sleep/wake and restart tests.
- Blocked by: S6-F4-T8, S6-F8-T7, S6-F9-T1, S6-F9-T2
- Blocks: S6-F9-T8
- Context: app shutdown, automation, usage daemon, mobile bridge.

### S6-F9-T8 — Close performance and regression-gate acceptance

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F9
- Outcome: Required budgets pass on documented hardware/platforms and bounded gates prevent silent regression.
- Scope: Matrix S6-PF; consolidated report; CI/local subset; long soak; package; support limits; variance; documentation; approved exceptions.
- Out of scope: Unsupported hardware promises.
- Acceptance: No required metric exceeds budget; exceptions name owner/expiry; correctness matrices remain green.
- Verification: Node 22 npm run check, strict OpenSpec, benchmark suite, native platform/package runs, 24h soak, independent report review.
- Blocked by: S6-F9-T2, S6-F9-T3, S6-F9-T4, S6-F9-T5, S6-F9-T6, S6-F9-T7
- Blocks: S6-F10-T8, S6-F11-T6, S6-F12-T9
- Context: docs/stage6-full-feature-test-matrix.md and performance reports.

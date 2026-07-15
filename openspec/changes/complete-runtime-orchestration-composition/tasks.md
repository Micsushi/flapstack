# S5-F7 — Runtime and Orchestration Composition

### S5-F7-T1 — Reconcile F3/F11 ownership, ports, and compatibility versions

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F7
- Outcome: Every request/control/activity field has one authoritative owner and versioned consumer contract.
- Scope: Current seam audit; port schemas; adapter/version probes; snapshot fields; diagnostics; deprecation; failure taxonomy; migration.
- Out of scope: Provider implementation.
- Acceptance: No duplicate process/parser/activity owner; every unsupported path fails before mutation; Stage 4 snapshots remain readable.
- Verification: Contract/compatibility/migration tests and architecture review.
- Blocked by: fully accepted S4-F3 and S4-F11
- Blocks: S5-F7-T2, S5-F7-T3, S5-F7-T4, S5-F7-T5
- Context: RuntimeLaunchCoordinator, coordination engines, activity references.

### S5-F7-T2 — Route Codex coordination through F11 App Server authority

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F7
- Outcome: Codex V2/V1 coordination uses one F11-owned client, request version, session, and event source.
- Scope: codexCoordination consumer port; capability/version probe; task-path/mailbox/follow-up/interrupt; request correlation; cancellation; diagnostics; no fallback.
- Out of scope: Reimplementing App Server client in F3.
- Acceptance: One process/session; unsupported version blocks; events retain provider/run/task-path provenance; cancellation reconciles.
- Verification: Protocol fixtures, process-count, request/version, mailbox/follow-up/interrupt/cancel/restart tests and live Codex.
- Blocked by: S5-F7-T1
- Blocks: S5-F7-T5, S5-F7-T6
- Context: F11 Codex adapter/protocol client, F3 codex engines.

### S5-F7-T3 — Forward and enforce workflow structured-output schemas

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F7
- Outcome: Required outputSchema reaches supported adapters and validated durable output controls workflow barriers.
- Scope: Port field; capability matrix; Codex/Claude/Native mapping; canonical schema limits; output capture; validation; retry/repair; audit; optional-output behavior.
- Out of scope: Prompt-only imitation when unsupported.
- Acceptance: Required unsupported blocks before durable worker; invalid/absent output fails barrier; optional output remains optional.
- Verification: Cross-adapter schema/invalid/absent/oversize/retry/checkpoint/restart tests and credentialed live paths.
- Blocked by: S5-F7-T1
- Blocks: S5-F7-T5, S5-F7-T6
- Context: F3 workflow schemas, F11 launch input, provider structured output.

### S5-F7-T4 — Add capability-gated active-run pause and resume

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F7
- Outcome: Individual and cascade pause/resume report exact authoritative results without synthetic state.
- Scope: Optional Runtime methods; adapter mappings; state/CAS; race with cancel/terminal; group cascade; partial result; activity/audit; recovery.
- Out of scope: Suspending OS processes without provider contract.
- Acceptance: Unsupported unchanged; terminal wins races; resume cannot replay/duplicate; persisted state matches provider observation.
- Verification: Capability/race/cascade/partial/terminal/restart tests and live supported providers.
- Blocked by: S5-F7-T1
- Blocks: S5-F4-T6, S5-F6-T5, S5-F7-T5, S5-F7-T6
- Context: runtime controls, cascade control, lifecycle CAS.

### S5-F7-T5 — Unify activity references, cancellation, and recovery without replay

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F7
- Outcome: F3 projections reference exact F11 activity/lifecycle while preserving workflow-only events and attempt identity.
- Scope: Activity high-water; ordered merge; definition/run/agent/checkpoint identity; reservation; terminal CAS; cancellation intent; crash windows; uncertain state; cleanup.
- Out of scope: Copying native activity into F3-owned rows.
- Acceptance: Dedupe/reorder/restart safe; prior runs cannot satisfy fresh attempts; partial cancellation persists; uncertainty never auto-replays.
- Verification: Concurrent reservation, crash/fault, terminal-race, activity-order/dedupe, restart/no-replay and long-history tests.
- Blocked by: S5-F7-T1, S5-F7-T2, S5-F7-T3, S5-F7-T4
- Blocks: S5-F4-T4, S5-F6-T4, S5-F7-T6, S5-F7-T7
- Context: F11 activity store, F3 workflow checkpoints/fleet.

### S5-F7-T6 — Prove live provider and macOS package composition

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F7
- Outcome: Codex, Claude Code, and Flapstack Native mixed workflows prove request, schema, control, activity, and recovery on verified Dev and the macOS preview package.
- Scope: Credentials; permission modes; package residency; adapter versions; output schema; pause/resume; cancel; forced restart; diagnostics. Windows/Linux parity is owned by S5-F10.
- Out of scope: Claiming unavailable provider capabilities.
- Acceptance: Limitations recorded per adapter/platform; no silent fallback; exact build/profile/version evidence.
- Verification: Credentialed verified-Dev and macOS preview-package matrix with forced restart and logs; native Windows/Linux composition is repeated by S5-F10.
- Blocked by: S5-F7-T2, S5-F7-T3, S5-F7-T4, S5-F7-T5
- Blocks: S5-F7-T7, S5-F11-T3, S5-F11-T6
- Context: runtime fixtures, package manifests, platform matrix.

### S5-F7-T7 — Close Runtime/orchestration composition acceptance

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S5 / Feature S5-F7
- Outcome: All F3/F11 composition seams pass automated, live, restart, and package evidence.
- Scope: Matrix S5-RO; migrations; ports; Codex; structured output; pause/resume; activity; no-replay; security; docs.
- Out of scope: New coordination engine.
- Acceptance: One mixed workflow completes with exact schemas/activity/control; crash/restart never duplicates; every ownership boundary stays intact.
- Verification: Node 22 npm run check, strict OpenSpec, verified Dev, credentialed provider/platform/package matrix.
- Blocked by: S5-F7-T5, S5-F7-T6
- Blocks: S5-F4-T8, S5-F6-T8, S5-F11-T3, S5-F11-T4, S5-F11-T6
- Context: docs/stage5-full-feature-test-matrix.md.

# S4-F3 Multi-Agent Operations — re-review packet

Historical implementation packet. S4-F3 core is now accepted at Tier 2;
provider capability certification remains separate in the Stage 4 matrix.

## F3-owned implementation

- `0037_multi_agent_operations` and its schema/snapshot: policies, templates,
  workflow runs/checkpoints, coordination intents/messages, cascade intents and
  targets, durable transition sources, and rebuildable activity projections.
- `src/main/lib/agent-orchestration/{operations-config,approval-authority,
workflow-engine,cascade-control,codex-engines,fleet,activity-projection,
operations-runtime,runtime-launch-port,codex-app-server-coordination,
worker-materializer-port}.ts` plus the F3 service/router wiring.
- Fleet, lineage, launch preview, activity, and coordination-settings renderer
  surfaces and their focused tests.
- This OpenSpec change, F3 evidence documents, and S4-MA01 through S4-MA10 rows.

Exact F3-owned file/hunk inventory:

- `openspec/changes/extend-multi-agent-operations/**`;
  `docs/stage4-s4-f3-*.md`; the S4-MA additions in
  `docs/stage4-full-feature-test-matrix.md`.
- `drizzle/0037_multi_agent_operations.sql`,
  `drizzle/meta/0035_snapshot.json`, its journal entry, and the
  multi-agent-operations section of `src/main/lib/db/schema/index.ts`.
- `src/main/lib/agent-orchestration/{activity-projection,approval-authority,
cascade-control,codex-engines,coordination-engine,fleet,operations-config,
operations-runtime,runtime-launch-port,workflow-engine,
codex-app-server-coordination,worker-materializer-port}.ts` and F3 transition,
  fleet, lineage, messaging, and coordination hunks in `service.ts`.
- `src/main/lib/trpc/routers/{coordination-engines,
orchestration-operations}.ts`; F3 router registration, startup recovery, and
  durable cascade-control hunks in shared router/startup files.
- `src/shared/{coordination-engine,orchestration-operations}.ts` and F3 fleet,
  lineage, messaging, policy, and engine fields in `agent-orchestration.ts`.
- Coordination settings/launch preview, fleet, lineage, activity, and task-card
  renderer surfaces plus their registration hunks.
- `tests/{coordination-engine-*,orchestration-*}.test.*` F3 files and the F3
  additions to `agent-orchestration-service.test.ts`.

## Review corrections

- Policy relaxations and template authority/budget launches now obtain and
  verify a real Stage 3 Tier-3 approval. Verification binds the completed audit
  row to the approval decision, caller chat/run, exact tool, and canonical input
  context. Fake, mismatched, or consumed audit IDs fail.
- Template storage recursively scans keys and every string value. Credential,
  token, private-key, bearer, URL-authority, live identity, and secret-path
  patterns are rejected across prompt, spec, completion criteria, model, and
  worktree path fields.
- Workflow run and checkpoint creation is atomic. Branch, loop, parallel,
  pipeline, barrier, and human-gate steps have explicit semantics. Parallel and
  total-agent caps, token/cost budgets, retry counts, timeouts, output schemas,
  human gates, and stop intent fail closed. The engine transactionally
  materializes missing worker chats/subchats/runs from immutable agent and
  Runtime snapshots, excludes those runs from generic pending drain, schedules
  durable workflow runs automatically, and launches ready worker waves
  concurrently inside policy caps. F3 passes output schemas through its typed
  F11 request seam, reads final JSON only from the authoritative Runtime activity
  projection, and stores that immutable event reference. Missing or invalid
  output follows the persisted retry/failure policy.
- Template agents have stable unique definition IDs; worker steps carry an
  exact definition reference and control steps cannot. Before checkpoint claim,
  the bridge matches task/run/chat/subchat, the durable orchestration-agent row,
  and its full definition snapshot. Runtime run and orchestration-agent
  reservation keys plus a checkpoint-attempt key are append-only and single-use.
  All three bind the exact run and agent identity.
- Cascade request re-queries descendants under one immediate transaction and
  rejects stale preview fingerprints. Stop delegates to the concrete
  provider-neutral F11 cancel authority. Pause/resume consumers delegate only
  when optional F11 authority exists and change task/workflow truth only after
  every target acknowledges; absent authority fails closed.
  Per-target failures remain retryable and provider errors are bounded/redacted.
- Codex action keys use canonical JSON. Unique-key insertion, dispatch, and
  reconciliation use single-owner claims. Intent ID plus idempotency key reaches
  provider dispatch/reconciliation even without provider identity. Provider
  awaits hold no database connection. Claimed intent completion and message
  insertion commit together with exactly one updated row.
- Fleet filtering, keyset pagination, count, facets, and provider scope execute
  in SQL. Only agents belonging to the current page are loaded. Fleet rows carry
  the authoritative orchestration-owned saved workspace and the renderer opens
  it through the existing saved-workspace selection contract.
- Lineage controls dispatch V2 send/follow-up/interrupt through the latest
  durable intent identity; V1 exposes only its real supported controls. The task
  card includes an inspectable workflow panel for template start, advance,
  pause/resume/stop, human gates, retries, and checkpoint failures.
- Durable transition events are the rebuild source. Orchestration/agent/workflow/
  cascade/coordination mutations project automatically; restart rebuild does not
  infer historical transitions from current snapshots. Activity summaries are
  redacted and bounded before source or projection storage. The public UI repair
  mutation is removed.
- Workflow, cascade, activity recovery, and Codex coordination are exposed
  through production service/router/startup paths. The F3/F11 bridge loads the
  exact durable worker identity and immutable Runtime snapshot, then delegates
  launch/reconcile/cancel to the singleton F11 service. Optional pause/resume
  methods are consumed when F11 supplies them and fail closed when absent.
  Structured output may use an F11 method or F3's durable activity reader.
  Lifecycle and authoritative activity-sequence references return without
  provider text.
  Adapter construction and selection remain outside F3.
- The workflow launch path exposes one provider-neutral pre-durable materializer.
  It runs after dependency/retry/concurrency/budget/permission/worktree checks and
  before any worker chat/subchat/agent/run or F11 reserve/launch side effect.
  A renewable claim persists the exact returned definition and optional profile
  snapshot metadata. Failure is bounded/redacted and creates zero worker rows;
  concurrent pause/resume reuses the same attempt and snapshot.
- Codex V2/V1 coordination maps durable actions directly to App Server
  thread/turn requests. F11 owns the process, permissions, notifications, and
  stream parsing through a two-method request/version injection port; F3 owns
  only action mapping, durable intent/idempotency, identity, and reconciliation.

## F11 prerequisites present but not claimed as F3

This dirty worktree also preserves the accepted integration prerequisite slice:

- mobile-free `0034_agent_runtime`, `0035_agent_activity`, and
  `0036_coordination_engines` migrations/snapshots;
- shared Runtime/activity contracts and `src/main/lib/agent-runtime/*`;
- Runtime snapshot materialization call sites and Runtime/activity routers/UI.

That includes `src/shared/{agent-runtime,agent-activity}.ts`,
`src/main/lib/agent-runtime/**`, the agent Runtime/activity routers and tests,
and the Runtime snapshot hunks in provider/run/materialization call sites.

F3 consumes only durable run/chat/subchat identity, persisted
`ResolvedRuntimeLaunch`, provider-neutral five-state lifecycle, and activity
sequence references. It does not select adapters, probe Runtime availability,
parse provider streams, or copy Runtime activity text. Startup binds the bridge
when the reviewed F11 singleton export is present and otherwise leaves F3
Runtime operations unavailable with no fallback. Optional pause/resume authority
remains F11-owned and is not implemented by this packet. F3 passes output schemas
through its typed F11 queued-run consumer seam and can read/validate final JSON
from the authoritative activity projection without parsing provider streams.
F11 still owns provider-side schema forwarding. F11 feature acceptance remains
an external dependency.

## Deferred F10/mobile prerequisite cleanup, not F3

The authoritative integration base deliberately removed the stale mobile 0031,
mobile OpenSpec change, mobile bridge/pairing source and tests, and mobile-only
dependencies. This worktree preserves that prerequisite so 0035 descends from
the exact mobile-free 0034. Those deletions are not claimed as F3-owned work.

The mobile dependency removals in `package.json`/`package-lock.json` and mobile
startup/router/settings shutdown hunks are likewise F10 cleanup, not F3.

## Other preserved integration prerequisites, not F3

- The earlier `f126` salvage checkout was unavailable at review closeout. Work
  used the authoritative integration-preserved T6/0034 state and did not
  reconstruct or overwrite it from memory.
- Mobile-free `0033_saved_workspaces` and its snapshot are an accepted upstream
  prerequisite, not F3.
- Automation scheduler/startup/shutdown changes already present in integration
  are preserved shared work and are not claimed by F3.
- Shared schema/router/startup files contain these prerequisite hunks alongside
  F3-owned hunks; the coordinator must review and stage by hunk/scope rather than
  treating each shared file as wholly F3-owned.

## Migration proof

- `0035_snapshot.prevId` equals authoritative `0034_snapshot.id`
  `8a74937c-e510-4f4c-a4d3-4de0ab513120`.
- Current 0035 has 56 tables: authoritative 45 plus eleven F3 tables.
- No 0034/0035 table or identity contains `mobile`.
- A pre-0031 fixture directly applies 0031 through 0035, passes foreign-key and
  integrity checks, closes, and reopens.
- Policy history is append-only; approval audit IDs are single-consumption.

## Acceptance truth

### Consolidated F3 gate — 2026-07-14

- Node `v22.23.1`.
- Repository ESLint passed.
- Repository Prettier check found only the regenerated `0035_snapshot.json`;
  that generated snapshot was formatted and its focused Prettier check passed.
- TypeScript `tsc --noEmit` passed.
- The 21-file F3 plus accepted Runtime/activity/coordination seam slice passed:
  237 tests.
- Production Electron/Vite build passed.
- Ephemeral OpenSpec CLI strict validation passed for
  `extend-multi-agent-operations`.
- Focused migration proof passed inside that slice: direct pre-0031 replay through
  0035, close/reopen, metadata chain, integrity, and no mobile residue.
- A post-gate evidence test exposed and fixed stale in-memory control-checkpoint
  state before a dependent barrier. Current `orchestration-operations-review`
  passes 11/11, including max-total-agent, parallel, pipeline, barrier success,
  and fail-closed coverage; focused ESLint, TypeScript, and a current production
  build also pass after that fix. No second feature-wide test gate was run.

### F11 seam amendment — 2026-07-14

- The reviewed F11 singleton contract was compared directly in worktree `4ba0`.
  F3 now uses its real `launch(QueuedAgentRun)`, five-state `reconcileRun`, and
  `cancel` shape through a thin provider-neutral bridge instead of inventing a
  second launch/reference authority.
- The bridge requires matching task/run/chat/subchat ownership, loads the exact
  durable prompt, permissions, working paths, and immutable Runtime snapshot,
  and derives activity references from `agent_activity_events.sequence` high
  water. It does not select adapters or copy provider activity text.
- Initial attempts accept only fresh pending Runtime rows. The exact checkpoint
  reservation and pending-run CAS commit together; a competing scheduler winner
  leaves the workflow checkpoint pending and cannot donate historical results.
  The same durable owner may recover its reservation, while running/uncertain
  checkpoints reconcile without launch replay.
- Cancellation is explicit and becomes a failed workflow checkpoint. F11 has no
  provider-neutral pause/resume authority, so those cascade actions fail closed
  without mutating task/workflow state.
- Codex V2 path validation now accepts canonical POSIX absolute, Windows
  drive-root, and UNC forms only. Traversal, root-relative Windows, device paths,
  repeated/mixed separators, and dot normalization forms fail closed. This is
  unit coverage, not Windows-live evidence.
- Latest Node 22 bounded review proof passes 37 tests across the workflow and
  operations review files, including exact definition binding, cross-step and
  retry reuse rejection, historical-run rejection, concurrent claim loss, and
  same-attempt/different-run reservation exclusion.
  Touched strict TypeScript, ESLint, Prettier, strict OpenSpec, and diff hygiene
  pass.
- No replacement feature-wide gate was run: the local worktree still lacks the
  concrete F11 singleton implementation and real Codex coordination clients;
  structured workflow output, pause/resume, and live provider paths remain open.

### Consolidated live/UI closeout — 2026-07-14

- Dev app started, applied migrations, opened its main window, and completed the
  isolated multi-agent recovery startup task without a fatal startup error.
- `npm run dev:verify` passed for this exact checkout and the `Flapstack Dev`
  profile.
- The worktree has no bundled Codex binary, so live provider discovery reported
  the truthful `resources/bin/darwin-arm64/codex ENOENT` package gap.
- Computer Use reported that the Mac was locked. Visual fleet/lineage/activity/
  settings inspection, keyboard/screen-reader accessibility, and multi-window
  proof were therefore not performed.
- Dev app was shut down cleanly and the shared UI lock is free.

### Whole-feature headless amendment — 2026-07-14

- Ownership repair restores `agent-runtime/launch-coordinator.ts`,
  `main-run-launcher.ts`, and their two Runtime test files byte-for-byte to
  parent `aa84dc3`; they are absent from the combined F3 diff. Required Node
  `v22.23.1` passes the amended 13-file F3 gate with 115 tests plus strict
  TypeScript, touched formatting/lint, strict OpenSpec, and diff hygiene. The
  amended production build remains unavailable because the shared heavy-job
  lock is owned by another build (`pid 75613`); no lock bypass is claimed.
- This isolated packet adds workflow-owned Runtime materialization, drain
  exclusion, automatic workflow advancement, concurrent ready waves, dependent
  phase advancement, optional structured JSON output validation with immutable
  Runtime activity references, and fail-closed optional pause/resume consumers.
- Fleet operation-workspace navigation, capability-gated lineage messaging,
  provider-identity projection, and an inspectable workflow control/checkpoint
  panel now have production wiring and focused component/service coverage.
- Codex coordination clients can be registered without replacing the F11
  Runtime port. Capability probes fail closed on version drift or request error.
  The direct mapper uses supported App Server thread/turn requests and never
  asks a model to invoke coordination tools. Registration occurs only when F11
  supplies its owned request/version authority; no second process or activity
  parser is created by F3.
- F11 remains the only Runtime adapter selector and the only source of provider
  activity. F3 consumes immutable launch snapshots plus lifecycle/activity
  references and never copies Runtime activity. This packet does not implement
  F11 singleton lifecycle, provider stream dispatch/parsing, or pause/resume.
  F3 adds only typed consumer seams for Codex requests and output schemas.
- Live UI evidence is frozen to the dedicated UI coordinator/tester and is not
  claimed by this packet. No UI lease or production app was used.

T1 and T6 remain complete. T2–T5 and T7–T10 remain open. S4-MA01 through
S4-MA10 remain open.

Unclaimed dependencies/evidence:

- Saved-workspace roster/layout and multi-window live verification beyond the
  F3 fleet navigation contract.
- F11-T10 acceptance and provider-native process suspension semantics beyond
  Flapstack-owned activity-delivery pause/resume.
- F11 composition of the new `codexCoordination` request/version authority and
  queued-run `outputSchema` field, plus provider-neutral pause/resume methods.
- Real Codex V2/V1, Codex plus Claude mixed workflow, cancellation, restart, and
  provider reconciliation walkthroughs.
- Dedicated-tester live UI, multi-window, and manual accessibility proof.
- Signed and visually inspected package preview.

No commit, merge, push, task finalization, or acceptance claim is authorized.

### Missing production-path amendment — 2026-07-15

- The isolated packet remains based on accepted F3 commit
  `5290e52c6818212f220e6d9ce6588b13f32bb1a9`; no integration ref moved.
- A generic pre-durable worker materializer now persists one exact attempt and
  optional profile metadata before any durable worker or F11 side effect.
  Failure, identity/topology mutation, concurrent claims, pause/resume, and
  zero-row guarantees have focused coverage.
- Direct Codex V2/V1 coordination now maps supported App Server thread/turn
  requests behind an F11-owned request/version port. F3 creates no provider
  process and parses no provider stream. Unknown/version-drift states fail
  closed, and supported fork/send/follow-up/wait/interrupt/complete/residency
  plus V1 legacy mappings have request-contract coverage.
- Structured output passes the schema through the typed F11 queued-run seam;
  F3 reads and validates only the authoritative completed activity projection.
  Pause/resume remains an optional F11 lifecycle authority and fails closed.
- Node 22 focused proof: TypeScript passed; scoped ESLint and Prettier passed;
  three F3/coordination suites passed 75 tests; strict OpenSpec passed; diff
  hygiene passed. The standalone F11 main-service suite did not start because
  this `--ignore-scripts` install has no Electron binary, so it produced zero
  test evidence and is not claimed.
- No broad gate, build, UI, provider, package, device, rebase, commit, merge, or
  push was run for this amendment.

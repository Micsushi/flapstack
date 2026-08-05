# S4-F3-T2 orchestration fleet evidence

Historical implementation evidence. S4-F3 core is now accepted at Tier 2.

S4-F3-T2 adds one read-only fleet projection over the shipped Stage 3
`task_orchestrations`, `orchestration_agents`, `agent_runs`, and `chats` rows.
It does not add or mutate scheduler, engine, policy, workflow, lineage,
workspace, Runtime activity, schema, migration, or mobile state.

## Read model

- `queryOrchestrationFleet` applies caller/project/task/status/lifecycle/archive
  scope in SQL before agent materialization, reads agents in batches of at most
  500 task IDs, then applies provider filtering and stable keyset pagination.
- Sorting uses the selected durable field plus `taskId` as the stable tie-breaker.
- `createAgentOrchestrationService(...).listFleet` enables SQLite query-only
  mode and never calls `safeTickTask`, launches, reconciles, or replays work.
- Stage 3 rows expose the explicit `Legacy graph` engine identity until the
  separately owned coordination-engine task adds immutable engine snapshots.
- Provider identity records whether it came from the durable agent definition,
  harness mapping, or is unknown. The renderer exposes provider and harness;
  it does not hide provenance.
- Active rows are `live` only inside the bounded durable-update window, become
  `stale` outside it, terminal rows remain `terminal`, and malformed or
  unclassifiable rows remain `unknown` with an explanation.
- Cost totals stay separated as exact, provider-reported, and estimated.
  Aggregate quality uses the weakest included provenance, including unknown.

## Renderer and refresh

- The sidebar opens the cross-project `Orchestration fleet` view.
- Project, task, status, provider, lifecycle, archive, and sort controls are
  labeled native selects.
- Results use one roving row tab stop with Arrow Up/Down, Home, and End focus.
  Focus selects the matching detail panel.
- Detail shows task/project identity, freshness reason, engine provenance,
  providers, harnesses, limits, blockers, split usage provenance, agents, runs,
  chats, and only live chat navigation.
- Loading, empty, stale, unknown, terminal, error/retry, and pagination states
  have explicit text and live-region semantics.
- Every open fleet view polls read-only state every five seconds, covering
  scheduler and worker writes in every window. Existing orchestration
  invalidation also refreshes the fleet immediately for tRPC and Product MCP
  mutations.
- Tier-0 Product MCP adds scoped `list_orchestrations`; its output excludes
  prompts and other hidden definition fields.

## Verification

Node `v22.23.1`:

- 38 focused service, pagination, large-fleet, restart, MCP, invalidation,
  component, navigation, and accessibility tests passed across seven files.
- A 1,005-orchestration project returned a stable 25-row page while agent reads
  were bounded to `500 + 500 + 5` task IDs.
- Read-only tests proved task, chat, run, and agent row counts unchanged across
  initial, paginated, filtered, stale, unknown, and restarted reads.
- `tsc --noEmit` passed.
- Focused ESLint and Prettier passed.
- Production `npm run build` passed under the repository heavy-job lease.
- `openspec validate extend-multi-agent-operations --strict --no-interactive`
  passed.
- `git diff --check` passed.

No live UI, package preview, credentialed provider, OS, or device evidence is
claimed by this task; none is required by its query/component acceptance.

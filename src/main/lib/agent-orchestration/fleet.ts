import {
  orchestrationAgentDefinitionSchema,
  orchestrationFleetQuerySchema,
  type OrchestrationAggregateDto,
  type OrchestrationFleetAgentDto,
  type OrchestrationFleetItemDto,
  type OrchestrationFleetPageDto,
  type OrchestrationFleetQuery,
  type OrchestrationFleetSort,
} from "../../../shared/agent-orchestration"
import { interpretCoordinationEngineSnapshot } from "./coordination-engine"
import { epochSecondsToMilliseconds } from "../db/timestamps"
import { providerForHarness } from "../usage/budgets"

type Row = Record<string, unknown>

export type OrchestrationFleetStore = {
  prepare: (sql: string) => { all: (...params: unknown[]) => Row[] }
}

export type OrchestrationFleetQueryOptions = {
  nowMs?: number
  staleAfterMs?: number
  visibleProjectId?: string | null
  visibleTaskId?: string | null
}

type Cursor = {
  version: 1
  sort: OrchestrationFleetSort
  taskId: string
  value: number | string
}

const ACTIVE_STATUSES = new Set(["queued", "running", "paused"])
const TERMINAL_STATUSES = new Set(["completed", "failed", "stopped"])
const COST_QUALITIES = new Set(["exact", "provider-reported", "estimated", "unknown"])
const DEFAULT_STALE_AFTER_MS = 30_000
const MAX_CURSOR_NAME_LENGTH = 512

export function queryOrchestrationFleet(
  store: OrchestrationFleetStore,
  inputValue: unknown,
  options: OrchestrationFleetQueryOptions = {},
): OrchestrationFleetPageDto {
  const input = orchestrationFleetQuerySchema.parse(inputValue)
  const nowMs = options.nowMs ?? Date.now()
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS
  const sqlScope = fleetSqlScope(input, options)
  const cursor = input.cursor ? decodeCursor(input.cursor, input.sort) : null
  const sort = fleetSortSql(input.sort)
  const cursorScope = cursor ? keysetSql(sort.expression, input.sort, cursor) : null
  const pageConditions = [...sqlScope.conditions, ...(cursorScope ? [cursorScope.condition] : [])]
  const pageParams = [...sqlScope.params, ...(cursorScope?.params ?? []), input.limit + 1]
  const baseRows = store
    .prepare(
      `SELECT
         o.*,
         t.id joined_task_id,
         t.project_id,
         t.name task_name,
         t.archived_at task_archived_at,
         p.id joined_project_id,
         p.name project_name,
         p.archived_at project_archived_at,
         initiating.id joined_initiating_chat_id,
         initiating.archived_at initiating_chat_archived_at
       FROM task_orchestrations o
       LEFT JOIN tasks t ON t.id = o.task_id
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN chats initiating ON initiating.id = o.initiating_chat_id
       WHERE ${pageConditions.join(" AND ")}
       ORDER BY ${sort.expression} ${sort.direction}, o.task_id ASC
       LIMIT ?`,
    )
    .all(...pageParams)
  const hasMore = baseRows.length > input.limit
  const pageRows = baseRows.slice(0, input.limit)
  const taskIds = pageRows.map((row) => String(row.task_id))
  const agentRows = chunks(taskIds, 500).flatMap((ids) =>
    store
      .prepare(
        `SELECT
           a.*,
           linked_chat.id joined_chat_id,
           linked_chat.archived_at chat_archived_at,
           r.id joined_run_id,
           r.status run_status,
           r.harness run_harness,
           r.started_at run_started_at,
           r.completed_at run_completed_at
         FROM orchestration_agents a
         LEFT JOIN chats linked_chat ON linked_chat.id = a.chat_id
         LEFT JOIN agent_runs r ON r.id = a.run_id
         WHERE a.task_id IN (${ids.map(() => "?").join(",")})
         ORDER BY a.task_id, a.queued_at, a.id`,
      )
      .all(...ids),
  )
  const agentsByTask = new Map<string, Row[]>()
  for (const row of agentRows) {
    const taskId = String(row.task_id)
    const rows = agentsByTask.get(taskId) ?? []
    rows.push(row)
    agentsByTask.set(taskId, rows)
  }

  const items = pageRows.map((row) =>
    toFleetItem(row, agentsByTask.get(String(row.task_id)) ?? [], nowMs, staleAfterMs),
  )
  const totalRow = store
    .prepare(
      `SELECT count(*) total
       FROM task_orchestrations o
       LEFT JOIN tasks t ON t.id = o.task_id
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE ${sqlScope.conditions.join(" AND ")}`,
    )
    .all(...sqlScope.params)[0]
  const facets = queryFacets(store, sqlScope)

  return {
    items,
    total: Number(totalRow?.total ?? 0),
    nextCursor:
      hasMore && items.length > 0 ? encodeCursor(items[items.length - 1]!, input.sort) : null,
    observedAt: nowMs,
    facets,
  }
}

function fleetSqlScope(
  input: OrchestrationFleetQuery,
  options: OrchestrationFleetQueryOptions,
): { conditions: string[]; params: unknown[] } {
  const conditions = ["1 = 1"]
  const params: unknown[] = []
  const addIds = (column: string, values: string[]) => {
    if (values.length === 0) return
    conditions.push(`${column} IN (${values.map(() => "?").join(",")})`)
    params.push(...values)
  }
  if (options.visibleTaskId) addIds("o.task_id", [options.visibleTaskId])
  else if (options.visibleProjectId) addIds("t.project_id", [options.visibleProjectId])
  addIds("t.project_id", input.projectIds)
  addIds("o.task_id", input.taskIds)
  if (input.statuses.length > 0) addIds("o.status", input.statuses)
  else if (input.state === "active") addIds("o.status", [...ACTIVE_STATUSES])
  else if (input.state === "terminal") addIds("o.status", [...TERMINAL_STATUSES])
  else if (input.state === "unknown") {
    const known = [...ACTIVE_STATUSES, ...TERMINAL_STATUSES]
    conditions.push(`o.status NOT IN (${known.map(() => "?").join(",")})`)
    params.push(...known)
  }
  if (input.archiveScope === "visible") {
    conditions.push("t.archived_at IS NULL", "p.archived_at IS NULL")
  } else if (input.archiveScope === "archived") {
    conditions.push("(t.archived_at IS NOT NULL OR p.archived_at IS NOT NULL)")
  }
  if (input.providers.length > 0) {
    const providerExpression = fleetProviderSql("a", "r")
    addIds(providerExpression, input.providers.map(normalizeProvider))
    const providerCondition = conditions.pop()!
    conditions.push(
      `EXISTS (
        SELECT 1 FROM orchestration_agents a
        LEFT JOIN agent_runs r ON r.id = a.run_id
        WHERE a.task_id = o.task_id AND ${providerCondition}
      )`,
    )
  }
  return { conditions, params }
}

function fleetSortSql(sort: OrchestrationFleetSort) {
  if (sort === "name-asc")
    return {
      expression: "lower(coalesce(t.name, 'Missing task ' || o.task_id))",
      direction: "ASC" as const,
    }
  if (sort.startsWith("created"))
    return {
      expression: "coalesce(o.created_at, 0)",
      direction: sort.endsWith("-asc") ? ("ASC" as const) : ("DESC" as const),
    }
  return {
    expression: `max(
      coalesce(o.updated_at, o.created_at, 0),
      coalesce((
        SELECT max(max(coalesce(a.updated_at, 0), coalesce(r.started_at, 0), coalesce(r.completed_at, 0)))
        FROM orchestration_agents a LEFT JOIN agent_runs r ON r.id = a.run_id
        WHERE a.task_id = o.task_id
      ), 0)
    )`,
    direction: sort.endsWith("-asc") ? ("ASC" as const) : ("DESC" as const),
  }
}

function keysetSql(expression: string, sort: OrchestrationFleetSort, cursor: Cursor) {
  const value = typeof cursor.value === "number" ? cursor.value / 1_000 : cursor.value
  const primaryOperator = sort.endsWith("-asc") ? ">" : "<"
  return {
    condition: `(${expression} ${primaryOperator} ? OR (${expression} = ? AND o.task_id > ?))`,
    params: [value, value, cursor.taskId],
  }
}

function fleetProviderSql(agentAlias: string, runAlias: string) {
  return `lower(coalesce(
    nullif(json_extract(${agentAlias}.definition, '$.provider'), ''),
    CASE lower(coalesce(json_extract(${agentAlias}.definition, '$.harness'), ${runAlias}.harness, ''))
      WHEN 'codex' THEN 'openai'
      WHEN 'claude-code' THEN 'anthropic'
      WHEN 'cursor-agent' THEN 'cursor'
      WHEN 'openrouter' THEN 'openrouter'
      WHEN 'nanogpt' THEN 'nanogpt'
      WHEN 'local' THEN 'local'
      ELSE 'unknown'
    END
  ))`
}

function queryFacets(
  store: OrchestrationFleetStore,
  scope: { conditions: string[]; params: unknown[] },
): OrchestrationFleetPageDto["facets"] {
  const where = scope.conditions.join(" AND ")
  const base = `FROM task_orchestrations o
    LEFT JOIN tasks t ON t.id = o.task_id
    LEFT JOIN projects p ON p.id = t.project_id
    WHERE ${where}`
  const projects = store
    .prepare(
      `SELECT coalesce(t.project_id, 'unknown-project') id,
              coalesce(p.name, 'Missing project ' || coalesce(t.project_id, 'unknown-project')) label,
              count(*) count ${base}
       GROUP BY t.project_id, p.name ORDER BY lower(label), id`,
    )
    .all(...scope.params)
  const tasks = store
    .prepare(
      `SELECT o.task_id id, coalesce(t.name, 'Missing task ' || o.task_id) label,
              count(*) count ${base}
       GROUP BY o.task_id, t.name ORDER BY lower(label), id`,
    )
    .all(...scope.params)
  const statuses = store
    .prepare(
      `SELECT o.status id, o.status label, count(*) count ${base}
       GROUP BY o.status ORDER BY lower(label), id`,
    )
    .all(...scope.params)
  const providerExpression = fleetProviderSql("a", "r")
  const providers = store
    .prepare(
      `SELECT ${providerExpression} id, ${providerExpression} label,
              count(DISTINCT o.task_id) count
       FROM task_orchestrations o
       LEFT JOIN tasks t ON t.id = o.task_id
       LEFT JOIN projects p ON p.id = t.project_id
       JOIN orchestration_agents a ON a.task_id = o.task_id
       LEFT JOIN agent_runs r ON r.id = a.run_id
       WHERE ${where}
       GROUP BY ${providerExpression} ORDER BY lower(label), id`,
    )
    .all(...scope.params)
  const map = (rows: Row[]) =>
    rows.map((row) => ({ id: String(row.id), label: String(row.label), count: Number(row.count) }))
  return {
    projects: map(projects),
    tasks: map(tasks),
    statuses: map(statuses),
    providers: map(providers),
  }
}

function toFleetItem(
  row: Row,
  agentRows: Row[],
  nowMs: number,
  staleAfterMs: number,
): OrchestrationFleetItemDto {
  const taskId = String(row.task_id)
  const status = String(row.status ?? "unknown")
  const state = stateForStatus(status)
  const agents = agentRows.map(toFleetAgent)
  const aggregate = aggregateAgents(agents)
  const createdAt = millis(row.created_at) ?? 0
  const updatedAt = Math.max(
    millis(row.updated_at) ?? createdAt,
    ...agentRows.flatMap((agent) =>
      [agent.updated_at, agent.run_started_at, agent.run_completed_at]
        .map(millis)
        .filter((value): value is number => value !== null),
    ),
  )
  const freshness = freshnessFor(state, updatedAt, nowMs, staleAfterMs)
  const taskName = stringValue(row.task_name) ?? `Missing task ${taskId}`
  const projectId = stringValue(row.project_id) ?? "unknown-project"
  const projectName = stringValue(row.project_name) ?? `Missing project ${projectId}`
  const providers = unique(agents.map((agent) => agent.provider)).sort()
  const harnesses = unique(agents.map((agent) => agent.harness)).sort()
  const initiatingChatId = String(row.initiating_chat_id)
  const engineSnapshot = interpretCoordinationEngineSnapshot(row)

  return {
    taskId,
    taskName,
    taskArchived: row.task_archived_at != null,
    projectId,
    projectName,
    projectArchived: row.project_archived_at != null,
    status,
    state,
    freshness,
    freshnessReason: freshnessReason(freshness, updatedAt, staleAfterMs),
    createdAt,
    updatedAt,
    completedAt: millis(row.completed_at),
    maxParallelAgents: boundedNumber(row.max_parallel_agents),
    maxDepth: boundedNumber(row.max_depth),
    blockerCount:
      boundedNumber(row.blocker_count) + agents.reduce((sum, agent) => sum + agent.blockerCount, 0),
    providers,
    harnesses,
    aggregate,
    engine: {
      id: engineSnapshot.engine,
      label:
        engineSnapshot.engine === "workflow"
          ? engineSnapshot.source === "legacy"
            ? "Legacy graph"
            : "Workflow"
          : engineSnapshot.engine === "codex-v2"
            ? "Codex task tree (V2)"
            : "Codex legacy threads (V1)",
      version: engineSnapshot.engineVersion,
      provenance: engineSnapshot.source,
    },
    coordinationIdentity: { kind: "task", label: taskName },
    initiatingChat: {
      id: initiatingChatId,
      state: linkedState(
        initiatingChatId,
        row.joined_initiating_chat_id,
        row.initiating_chat_archived_at,
      ),
    },
    agents,
  }
}

function toFleetAgent(row: Row): OrchestrationFleetAgentDto {
  const parsed = orchestrationAgentDefinitionSchema.safeParse(parseJson(row.definition))
  const definition = parsed.success ? parsed.data : null
  const harness = definition?.harness ?? stringValue(row.run_harness) ?? "unknown"
  const explicitProvider = definition?.provider?.trim()
  const harnessProvider = providerForHarness(harness)
  const provider = explicitProvider || harnessProvider || "unknown"
  const chatId = stringValue(row.chat_id)
  const runId = stringValue(row.run_id)
  return {
    id: String(row.id),
    status: String(row.status ?? "unknown"),
    role: definition?.role ?? "Unknown agent",
    name: definition?.name ?? definition?.role ?? String(row.id),
    harness,
    provider,
    providerProvenance: explicitProvider ? "definition" : harnessProvider ? "harness" : "unknown",
    progressPercent: boundedNumber(row.progress_percent),
    blockerCount: boundedNumber(row.blocker_count),
    totalTokens: boundedNumber(row.total_tokens),
    costUsdMicros: nullableNumber(row.cost_usd_micros),
    costQuality: COST_QUALITIES.has(String(row.cost_quality))
      ? String(row.cost_quality)
      : "unknown",
    chat: {
      id: chatId,
      state: chatId ? linkedState(chatId, row.joined_chat_id, row.chat_archived_at) : "unknown",
    },
    run: {
      id: runId,
      status: runId && row.joined_run_id ? stringValue(row.run_status) : null,
    },
  }
}

function aggregateAgents(agents: OrchestrationFleetAgentDto[]): OrchestrationAggregateDto {
  const count = (status: string) => agents.filter((agent) => agent.status === status).length
  const costs = (quality: string) =>
    agents
      .filter((agent) => agent.costQuality === quality)
      .reduce((sum, agent) => sum + (agent.costUsdMicros ?? 0), 0)
  const exact = costs("exact")
  const reported = costs("provider-reported")
  const estimated = costs("estimated")
  return {
    total: agents.length,
    queued: count("queued"),
    active: count("active"),
    completed: count("completed"),
    failed: count("failed"),
    blocked: agents.filter((agent) => agent.blockerCount > 0).length,
    stopped: count("stopped"),
    progressPercent:
      agents.length === 0
        ? 0
        : Math.floor(agents.reduce((sum, agent) => sum + agent.progressPercent, 0) / agents.length),
    totalTokens: agents.reduce((sum, agent) => sum + agent.totalTokens, 0),
    exactCostUsdMicros: exact,
    providerReportedCostUsdMicros: reported,
    estimatedCostUsdMicros: estimated,
    costQuality:
      agents.length === 0 || agents.some((agent) => agent.costQuality === "unknown")
        ? "unknown"
        : agents.some((agent) => agent.costQuality === "estimated")
          ? "estimated"
          : agents.some((agent) => agent.costQuality === "provider-reported")
            ? "provider-reported"
            : "exact",
  }
}

function stateForStatus(status: string): OrchestrationFleetItemDto["state"] {
  if (ACTIVE_STATUSES.has(status)) return "active"
  if (TERMINAL_STATUSES.has(status)) return "terminal"
  return "unknown"
}

function freshnessFor(
  state: OrchestrationFleetItemDto["state"],
  updatedAt: number,
  nowMs: number,
  staleAfterMs: number,
): OrchestrationFleetItemDto["freshness"] {
  if (state === "terminal") return "terminal"
  if (state === "unknown" || updatedAt <= 0 || updatedAt > nowMs + 5_000) return "unknown"
  return nowMs - updatedAt > staleAfterMs ? "stale" : "live"
}

function freshnessReason(
  freshness: OrchestrationFleetItemDto["freshness"],
  updatedAt: number,
  staleAfterMs: number,
): string {
  if (freshness === "terminal") return "Durable orchestration status is terminal."
  if (freshness === "live") return "Durable state changed within the live freshness window."
  if (freshness === "stale") {
    return `No durable state change within ${Math.round(staleAfterMs / 1_000)} seconds.`
  }
  return updatedAt <= 0
    ? "No valid durable update time is available."
    : "Durable state cannot be classified safely."
}

function linkedState(
  expectedId: string,
  joinedId: unknown,
  archivedAt: unknown,
): "live" | "archived" | "missing" | "unknown" {
  if (!expectedId) return "unknown"
  if (!joinedId) return "missing"
  return archivedAt == null ? "live" : "archived"
}

function sortValue(item: OrchestrationFleetItemDto, sort: OrchestrationFleetSort): number | string {
  if (sort.startsWith("created")) return item.createdAt
  if (sort === "name-asc") return item.taskName.toLocaleLowerCase()
  return item.updatedAt
}

function encodeCursor(item: OrchestrationFleetItemDto, sort: OrchestrationFleetSort): string {
  return Buffer.from(
    JSON.stringify({ version: 1, sort, taskId: item.taskId, value: sortValue(item, sort) }),
  ).toString("base64url")
}

function decodeCursor(value: string, sort: OrchestrationFleetSort): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<Cursor>
    if (
      parsed.version !== 1 ||
      parsed.sort !== sort ||
      typeof parsed.taskId !== "string" ||
      parsed.taskId.length === 0 ||
      parsed.taskId.length > 200 ||
      !isCursorValueForSort(parsed.value, sort)
    ) {
      throw new Error("invalid")
    }
    return parsed as Cursor
  } catch {
    throw new Error("Invalid orchestration fleet pagination cursor.")
  }
}

function isCursorValueForSort(
  value: unknown,
  sort: OrchestrationFleetSort,
): value is number | string {
  if (sort === "name-asc") {
    return typeof value === "string" && value.length > 0 && value.length <= MAX_CURSOR_NAME_LENGTH
  }
  return typeof value === "number" && Number.isFinite(value)
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function millis(value: unknown): number | null {
  if (value instanceof Date) return value.getTime()
  return epochSecondsToMilliseconds(value)
}

function boundedNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : null
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function normalizeProvider(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

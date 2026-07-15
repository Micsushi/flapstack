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
       WHERE ${sqlScope.conditions.join(" AND ")}`,
    )
    .all(...sqlScope.params)
  const taskIds = baseRows.map((row) => String(row.task_id))
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

  const visible = baseRows
    .filter((row) => withinCallerScope(row, options))
    .map((row) =>
      toFleetItem(row, agentsByTask.get(String(row.task_id)) ?? [], nowMs, staleAfterMs),
    )
    .filter((item) => withinArchiveScope(item, input.archiveScope))

  const facets = buildFacets(visible)
  const filtered = visible.filter((item) => matchesFilters(item, input))
  filtered.sort(comparator(input.sort))

  const cursor = input.cursor ? decodeCursor(input.cursor, input.sort) : null
  const afterCursor = cursor
    ? filtered.filter((item) => compareItemToCursor(item, cursor, input.sort) > 0)
    : filtered
  const pageItems = afterCursor.slice(0, input.limit)
  const hasMore = afterCursor.length > input.limit

  return {
    items: pageItems,
    total: filtered.length,
    nextCursor:
      hasMore && pageItems.length > 0
        ? encodeCursor(pageItems[pageItems.length - 1]!, input.sort)
        : null,
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
  return { conditions, params }
}

function withinCallerScope(row: Row, options: OrchestrationFleetQueryOptions): boolean {
  if (options.visibleTaskId) return String(row.task_id) === options.visibleTaskId
  if (options.visibleProjectId) return String(row.project_id) === options.visibleProjectId
  return true
}

function withinArchiveScope(
  item: OrchestrationFleetItemDto,
  scope: OrchestrationFleetQuery["archiveScope"],
): boolean {
  const archived = item.projectArchived || item.taskArchived
  if (scope === "visible") return !archived
  if (scope === "archived") return archived
  return true
}

function matchesFilters(item: OrchestrationFleetItemDto, input: OrchestrationFleetQuery): boolean {
  if (input.projectIds.length > 0 && !input.projectIds.includes(item.projectId)) return false
  if (input.taskIds.length > 0 && !input.taskIds.includes(item.taskId)) return false
  if (input.statuses.length > 0 && !input.statuses.includes(item.status)) return false
  if (input.state !== "all" && item.state !== input.state) return false
  if (input.providers.length > 0) {
    const wanted = new Set(input.providers.map(normalizeProvider))
    if (!item.providers.some((provider) => wanted.has(normalizeProvider(provider)))) return false
  }
  return true
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

function buildFacets(items: OrchestrationFleetItemDto[]): OrchestrationFleetPageDto["facets"] {
  return {
    projects: facet(items.map((item) => ({ id: item.projectId, label: item.projectName }))),
    tasks: facet(items.map((item) => ({ id: item.taskId, label: item.taskName }))),
    statuses: facet(items.map((item) => ({ id: item.status, label: item.status }))),
    providers: facet(
      items.flatMap((item) =>
        item.providers.map((provider) => ({ id: provider, label: provider })),
      ),
    ),
  }
}

function facet(values: Array<{ id: string; label: string }>) {
  const counts = new Map<string, { label: string; count: number }>()
  for (const value of values) {
    const current = counts.get(value.id)
    counts.set(value.id, { label: value.label, count: (current?.count ?? 0) + 1 })
  }
  return [...counts.entries()]
    .map(([id, value]) => ({ id, ...value }))
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id))
}

function comparator(sort: OrchestrationFleetSort) {
  return (left: OrchestrationFleetItemDto, right: OrchestrationFleetItemDto) => {
    const compared = compareValues(sortValue(left, sort), sortValue(right, sort), sort)
    return compared || left.taskId.localeCompare(right.taskId)
  }
}

function compareItemToCursor(
  item: OrchestrationFleetItemDto,
  cursor: Cursor,
  sort: OrchestrationFleetSort,
): number {
  const compared = compareValues(sortValue(item, sort), cursor.value, sort)
  return compared || item.taskId.localeCompare(cursor.taskId)
}

function compareValues(
  left: number | string,
  right: number | string,
  sort: OrchestrationFleetSort,
): number {
  const ascending = sort.endsWith("-asc")
  const compared =
    typeof left === "string" && typeof right === "string"
      ? left.localeCompare(right)
      : Number(left) - Number(right)
  return ascending ? compared : -compared
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

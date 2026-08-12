import { mcpAuditRecords } from "../db/schema"
import { createHash, randomUUID } from "node:crypto"
import { and, desc, eq, gte, isNull, lt, lte, or } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import type * as schema from "../db/schema"
import type { McpCallerIdentity, McpRiskTier } from "./types"
import { createOrchestrationInputSchema } from "../../../shared/agent-orchestration"

const MAX_DEPTH = 8
const MAX_ENTRIES = 50
const MAX_SUMMARY_LENGTH = 16_384
const redacted = "[REDACTED]"
const truncated = "[TRUNCATED]"
const secretKey =
  /(?:api[-_]?key|authorization|credential|cookie|pass(?:word)?|secret|token|private[-_]?key|session(?:[-_]?id)?|access[-_]?token|refresh[-_]?token)/i
const reasoningKey = /(?:reasoning|chain[-_]?of[-_]?thought|thinking)/i
const safeLiteralMarker = Symbol("safe-audit-literal")
type SafeAuditLiteral = { readonly value: string; readonly [safeLiteralMarker]: true }
const safeAuditKeys = new Set([
  "agentCount",
  "agentId",
  "agents",
  "archived",
  "branch",
  "browser",
  "byteLength",
  "capabilityFlags",
  "caller",
  "chatId",
  "completionCriteria",
  "content",
  "contextHash",
  "created",
  "customPermissions",
  "data",
  "decision",
  "dependencyAgentIds",
  "dependencyCount",
  "dryRun",
  "error",
  "expectedVersion",
  "git",
  "harness",
  "id",
  "initiatingChatId",
  "input",
  "itemCount",
  "keys",
  "limit",
  "maxBlockers",
  "maxCostUsdMicros",
  "maxDepth",
  "maxFailures",
  "maxParallelAgents",
  "maxTotalTokens",
  "maxWallClockMs",
  "mode",
  "model",
  "name",
  "network",
  "ok",
  "outcome",
  "overwrite",
  "permissionMode",
  "pinned",
  "productMcpRead",
  "productMcpTier3",
  "productMcpWrite",
  "projectId",
  "proposalCount",
  "proposalId",
  "proposalIds",
  "projectWrite",
  "prompt",
  "provider",
  "reasoningEffort",
  "result",
  "role",
  "runId",
  "schemaVersion",
  "scope",
  "sectionId",
  "secrets",
  "sha256",
  "shell",
  "source",
  "spec",
  "state",
  "status",
  "stopConditions",
  "subagents",
  "summary",
  "targetCompletedAgents",
  "targetProgressPercent",
  "taskId",
  "task",
  "thirdPartyMcp",
  "tier",
  "type",
  "worktreePath",
  "worktreeStrategy",
])
export type McpAuditStatus =
  | "allowed"
  | "dispatch-started"
  | "denied"
  | "approval-required"
  | "timed-out"
  | "stale"
  | "failed"
  | "completed"
  | "recovery-retryable"
  | "recovery-unknown"
  | "retry-authorized"
  | "retry-consumed"
  | "reconciled-completed"
  | "reconciled-failed"
  | "recovery-exhausted"

export type McpAuditSnapshot = Record<string, unknown> | null

export type AppendMcpAuditRecord = {
  id?: string
  invocationId?: string
  status: McpAuditStatus
  caller: McpCallerIdentity
  toolName: string
  tier: McpRiskTier
  chatSnapshot?: McpAuditSnapshot
  runSnapshot?: McpAuditSnapshot
  input?: unknown
  result?: unknown
  durationMs?: number
  createdAt?: Date
}

type AuditDatabase = Pick<BetterSQLite3Database<typeof schema>, "insert">
type RecoveryDatabase = Pick<
  BetterSQLite3Database<typeof schema>,
  "insert" | "select" | "transaction"
>

export type McpAuditDetailDto = {
  callerSummary: string
  chatSummary: string
  runSummary: string
  inputSummary: string
  resultSummary: string
}

/**
 * The only audit shape exposed outside storage. It deliberately contains the
 * already-redacted summaries, never raw invocation snapshots or payloads.
 */
export type McpAuditRecordDto = {
  id: string
  invocationId: string
  decision: McpAuditStatus
  callerChatId: string
  callerRunId: string | null
  toolName: string
  tier: McpRiskTier
  durationMs: number
  occurredAt: string
  detail: McpAuditDetailDto
}

export type McpAuditQuery = {
  callerChatId?: string
  toolName?: string
  decision?: McpAuditStatus
  from?: Date
  to?: Date
  cursor?: string
  limit?: number
}

export type McpAuditPage = {
  entries: McpAuditRecordDto[]
  nextCursor: string | null
}

type QueryDatabase = Pick<BetterSQLite3Database<typeof schema>, "select">

export type McpDispatchLookup = {
  invocationId: string
  caller: Pick<McpCallerIdentity, "chatId" | "runId">
  toolName: string
  input: unknown
}

export type McpDispatchRecoveryClaim = {
  invocationId: string
  callerChatId: string
  callerRunId: string | null
  toolName: string
  tier: McpRiskTier
  state: McpAuditStatus
  retrySafe: boolean
  createdAt: string
}

export type McpDispatchBlock = {
  invocationId: string
  state: McpAuditStatus
  relation: "same-invocation" | "matching-retry"
}

const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100

/** Store bounded, non-recoverable JSON suitable for durable audit summaries. */
export function redactMcpAuditSummary(value: unknown): string {
  const summary = JSON.stringify(redactValue(value, 0))
  return summary.length <= MAX_SUMMARY_LENGTH ? summary : JSON.stringify(truncated)
}

/**
 * Storage only. Invocation/approval paths own when records are appended.
 * Snapshot fields are serialized at write time and intentionally have no FKs.
 */
export function appendMcpAuditRecord(database: AuditDatabase, record: AppendMcpAuditRecord): void {
  const orchestrationContext = orchestrationAuditContext(record)
  database
    .insert(mcpAuditRecords)
    .values({
      ...(record.id ? { id: record.id } : {}),
      invocationId: record.invocationId ?? record.id ?? randomUUID(),
      status: record.status,
      callerChatId: record.caller.chatId,
      callerRunId: record.caller.runId ?? null,
      toolName: record.toolName,
      tier: record.tier,
      callerSnapshot: redactMcpAuditSummary({
        chatId: record.caller.chatId,
        runId: record.caller.runId ?? null,
        permissionMode: record.caller.permissionMode ?? null,
        customPermissions: record.caller.customPermissions ?? null,
      }),
      chatSnapshot: redactMcpAuditSummary(summarizeSnapshot(record.chatSnapshot)),
      runSnapshot: redactMcpAuditSummary(
        orchestrationContext ?? summarizeSnapshot(record.runSnapshot),
      ),
      inputSummary: redactMcpAuditSummary(summarizeMcpAuditInput(record.toolName, record.input)),
      resultSummary: redactMcpAuditSummary(summarizeMcpAuditResult(record.result)),
      durationMs: Math.max(0, Math.floor(record.durationMs ?? 0)),
      ...(record.createdAt ? { createdAt: record.createdAt } : {}),
    })
    .run()
}

function orchestrationAuditContext(record: AppendMcpAuditRecord): unknown | null {
  if (record.toolName !== "orchestrate_task" || record.status !== "completed") return null
  const result = asRecord(record.result)
  const data = asRecord(result?.data)
  const orchestration = asRecord(data?.orchestration)
  const taskId = orchestration?.taskId
  if (result?.ok !== true || typeof taskId !== "string" || !taskId) return null
  return { contextHash: createHash("sha256").update(taskId).digest("hex") }
}

/** Operation-specific allowlist. Arbitrary content is represented only by size and hash. */
export function summarizeMcpAuditInput(toolName: string, value: unknown): unknown {
  const input = asRecord(value)
  if (!input) return null
  const textDigest = (key: string) => summarizeText(input[key])
  const vaultTarget = () => ({
    projectId: textDigest("projectId"),
    sectionId:
      typeof input.sectionId === "string" &&
      ["index", "handoff", "decisions", "context", "tasks", "logs"].includes(input.sectionId)
        ? safeLiteral(input.sectionId)
        : null,
    ...(typeof input.expectedVersion === "number"
      ? { expectedVersion: input.expectedVersion }
      : {}),
  })
  const safe = (...keys: string[]) => {
    const entries: Array<[string, unknown]> = []
    for (const key of keys) {
      const item = input[key]
      if (typeof item === "boolean" || typeof item === "number") entries.push([key, item])
      if (typeof item === "string" && item.trim()) entries.push([key, summarizeText(item)])
    }
    return Object.fromEntries(entries)
  }

  switch (toolName) {
    case "create_chat":
      return {
        ...safe("scope", "projectId", "taskId", "harness", "model"),
        name: textDigest("name"),
      }
    case "create_task":
      return {
        ...safe("projectId"),
        name: textDigest("name"),
        description: textDigest("description"),
      }
    case "add_attachment":
      return {
        ...safe("chatId", "kind"),
        name: summarizeText(input.name),
        content: textDigest("contentText"),
      }
    case "write_attachment_to_worktree":
      return safe("attachmentId", "worktreePath", "targetRelativePath", "overwrite")
    case "launch_run":
      return {
        ...safe("chatId", "idempotencyKey"),
        initialPrompt: textDigest("initialPrompt"),
      }
    case "wait_for_chats":
      return safe("targetChatIds", "idempotencyKey")
    case "orchestrate_task":
      return summarizeOrchestrationAuthority(value)
    case "list_automations":
      return safe("includeArchived", "limit", "cursor")
    case "read_automation":
      return safe("automationId")
    case "create_automation_draft":
      return {
        ...safe("idempotencyKey"),
        draft: summarizeAutomationDraft(input.draft),
      }
    case "update_automation":
      return {
        ...safe("automationId", "expectedVersion"),
        draft: summarizeAutomationDraft(input.draft),
      }
    case "enable_automation":
      return safe("automationId", "expectedVersion", "enabled")
    case "propose_task": {
      const proposal = asRecord(input.proposal)
      return {
        ...safe("idempotencyKey"),
        proposal: proposal
          ? {
              projectId: summarizeText(proposal.projectId),
              name: summarizeText(proposal.name),
              description: summarizeText(proposal.description),
              targetStatus:
                typeof proposal.targetStatus === "string"
                  ? safeLiteral(proposal.targetStatus)
                  : null,
            }
          : null,
      }
    }
    case "list_task_proposals":
      return safe("projectId", "includeArchived", "limit", "cursor")
    case "read_task_proposal":
    case "cancel_task_proposal":
      return safe("proposalId", "expectedVersion")
    case "update_task_proposal": {
      const proposal = asRecord(input.proposal)
      return {
        ...safe("proposalId", "expectedVersion"),
        proposal: proposal
          ? {
              projectId: summarizeText(proposal.projectId),
              name: summarizeText(proposal.name),
              description: summarizeText(proposal.description),
              targetStatus:
                typeof proposal.targetStatus === "string"
                  ? safeLiteral(proposal.targetStatus)
                  : null,
            }
          : null,
      }
    }
    case "approve_task_proposal":
    case "approve_task_proposals":
    case "deny_task_proposal":
      return {
        ...safe("decision", "proposalId", "expectedVersion", "proposalCount"),
        proposalIds: Array.isArray(input.proposalIds) ? input.proposalIds.map(summarizeText) : [],
      }
    case "create_vault_section":
    case "update_vault_section":
    case "update_vault_handoff":
    case "create_vault_node":
    case "update_vault_node":
      return {
        ...vaultTarget(),
        content: textDigest("content"),
      }
    case "record_vault_decision":
      return {
        ...vaultTarget(),
        title: textDigest("title"),
        decision: textDigest("decision"),
        rationale: textDigest("rationale"),
      }
    case "search":
      return { ...safe("scope", "scopeId", "cursor", "limit"), query: textDigest("query") }
    case "rename_item":
      return { ...safe("kind", "id"), name: textDigest("name") }
    case "move_chat":
      return safe("id", "scope", "projectId", "taskId")
    case "archive_item":
    case "restore_item":
    case "pin_item":
      return safe("kind", "id", "pinned")
    case "list_projects":
    case "list_tasks":
    case "list_orchestrations":
    case "list_chats":
    case "list_runs":
    case "list_worktrees":
    case "list_artifacts":
      return safe("projectId", "taskId", "chatId", "runId", "cursor", "limit")
    case "list_vault_sections":
    case "read_vault_section":
    case "list_vault_nodes":
    case "read_vault_node":
    case "preview_vault_context":
    case "move_vault_node":
    case "link_vault_nodes":
      return vaultTarget()
    case "ping":
    case "describe":
      return null
    default:
      return { keys: Object.keys(input).sort().slice(0, MAX_ENTRIES) }
  }
}

function summarizeAutomationDraft(value: unknown): unknown {
  const draft = asRecord(value)
  if (!draft) return null
  const scope = asRecord(draft.scope)
  const action = asRecord(draft.action)
  const trigger = asRecord(draft.trigger)
  const run = asRecord(draft.run)
  const retry = asRecord(draft.retry)
  const budget = asRecord(draft.budget)
  const capabilities = asRecord(run?.customPermissions)
  const literal = (item: unknown) => (typeof item === "string" ? safeLiteral(item) : null)
  const boundedNumbers = (record: Record<string, unknown> | null, keys: string[]) =>
    Object.fromEntries(
      keys.flatMap((key) =>
        typeof record?.[key] === "number" || record?.[key] === null ? [[key, record[key]]] : [],
      ),
    )
  return {
    name: summarizeText(draft.name),
    description: summarizeText(draft.description),
    scope: scope
      ? {
          type: literal(scope.type),
          projectId: summarizeText(scope.projectId),
          taskId: summarizeText(scope.taskId),
          chatId: summarizeText(scope.chatId),
        }
      : null,
    action: action
      ? {
          type: literal(action.type),
          taskName: summarizeText(action.taskName),
          chatName: summarizeText(action.chatName),
        }
      : null,
    trigger: trigger
      ? {
          type: literal(trigger.type),
          cron: summarizeText(trigger.cron),
          timezone: summarizeText(trigger.timezone),
          catchUp: literal(trigger.catchUp),
          projectId: summarizeText(trigger.projectId),
          taskId: summarizeText(trigger.taskId),
          chatId: summarizeText(trigger.chatId),
          rootPath: summarizeText(trigger.rootPath),
          statuses: Array.isArray(trigger.statuses) ? trigger.statuses.map(literal) : [],
          includeGlobCount: Array.isArray(trigger.includeGlobs) ? trigger.includeGlobs.length : 0,
          excludeGlobCount: Array.isArray(trigger.excludeGlobs) ? trigger.excludeGlobs.length : 0,
          ...boundedNumbers(trigger, ["debounceMs"]),
        }
      : null,
    run: run
      ? {
          prompt: summarizeText(run.prompt),
          harness: literal(run.harness),
          model: summarizeText(run.model),
          permissionMode: literal(run.permissionMode),
          worktreeStrategy: literal(run.worktreeStrategy),
          worktreePath: summarizeText(run.worktreePath),
          capabilityFlags: capabilities,
        }
      : null,
    retry: boundedNumbers(retry, ["maxAttempts", "initialDelayMs", "maxDelayMs", "deadlineMs"]),
    budget: boundedNumbers(budget, [
      "maxDurationMs",
      "maxTotalTokens",
      "maxCostUsdMicros",
      "maxConcurrentRuns",
    ]),
  }
}

function summarizeOrchestrationAuthority(value: unknown): unknown {
  const parsed = createOrchestrationInputSchema.safeParse(value)
  if (!parsed.success) {
    const input = asRecord(value)
    return { keys: input ? Object.keys(input).sort().slice(0, MAX_ENTRIES) : [] }
  }
  const input = parsed.data
  return {
    projectId: summarizeText(input.projectId),
    initiatingChatId: summarizeText(input.initiatingChatId),
    task:
      input.task.mode === "create"
        ? { mode: safeLiteral("create"), name: summarizeText(input.task.name) }
        : { mode: safeLiteral("existing"), taskId: summarizeText(input.task.taskId) },
    agentCount: input.agents.length,
    maxParallelAgents: input.maxParallelAgents,
    maxDepth: input.maxDepth,
    stopConditions: input.stopConditions,
    agents: input.agents.map((agent) => ({
      ...(agent.agentId ? { agentId: summarizeText(agent.agentId) } : {}),
      role: summarizeText(agent.role),
      ...(agent.name ? { name: summarizeText(agent.name) } : {}),
      prompt: summarizeText(agent.prompt),
      ...(agent.spec ? { spec: summarizeText(agent.spec) } : {}),
      completionCriteria: summarizeText(agent.completionCriteria),
      harness: safeLiteral(agent.harness),
      provider: safeLiteral(agent.provider ?? (agent.harness === "codex" ? "openai" : "anthropic")),
      ...(agent.model ? { model: summarizeText(agent.model) } : {}),
      ...(agent.reasoningEffort ? { reasoningEffort: safeLiteral(agent.reasoningEffort) } : {}),
      permissionMode: safeLiteral(agent.permissionMode),
      ...(agent.customPermissions ? { capabilityFlags: agent.customPermissions } : {}),
      worktreeStrategy: safeLiteral(agent.worktreeStrategy),
      ...(agent.worktreePath ? { worktreePath: summarizeText(agent.worktreePath) } : {}),
      ...(agent.branch ? { branch: summarizeText(agent.branch) } : {}),
      dependencyCount: agent.dependencyAgentIds.length,
      dependencyAgentIds: agent.dependencyAgentIds.map(summarizeText),
    })),
  }
}

function summarizeMcpAuditResult(value: unknown): unknown {
  const result = asRecord(value)
  if (!result) return value === null ? null : { type: typeof value }
  const error = asRecord(result.error)
  const data = asRecord(result.data)
  const decision = asRecord(result.decision)
  return {
    ok: result.ok === true,
    ...(decision
      ? {
          decision: Object.fromEntries(
            ["id", "state", "source"].flatMap((key) =>
              typeof decision[key] === "string" ? [[key, summarizeText(decision[key])]] : [],
            ),
          ),
        }
      : {}),
    ...(error
      ? {
          error: {
            ...(typeof error.code === "string" ? { code: summarizeText(error.code) } : {}),
            ...(typeof error.message === "string" ? { message: summarizeText(error.message) } : {}),
          },
        }
      : {}),
    ...(data
      ? {
          data: {
            keys: Object.keys(data).sort().slice(0, MAX_ENTRIES),
            ...(typeof data.id === "string" ? { id: summarizeText(data.id) } : {}),
            ...(typeof data.runId === "string" ? { runId: summarizeText(data.runId) } : {}),
            ...(Array.isArray(data.items) ? { itemCount: data.items.length } : {}),
          },
        }
      : {}),
    ...(!error && !data ? { keys: Object.keys(result).sort().slice(0, MAX_ENTRIES) } : {}),
  }
}

function summarizeSnapshot(value: unknown): unknown {
  const snapshot = asRecord(value)
  if (!snapshot) return null
  const allowed = [
    "id",
    "chatId",
    "runId",
    "projectId",
    "taskId",
    "status",
    "scope",
    "harness",
    "permissionMode",
    "archived",
  ]
  return Object.fromEntries(
    allowed.flatMap((key) => {
      const item = snapshot[key]
      return typeof item === "string" || typeof item === "boolean" || typeof item === "number"
        ? [[key, item]]
        : []
    }),
  )
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function summarizeText(value: unknown): unknown {
  if (typeof value !== "string") return null
  return {
    byteLength: Buffer.byteLength(value),
    sha256: createHash("sha256").update(value).digest("hex"),
  }
}

/** Query append-only audit storage in a stable newest-first order. */
export function listMcpAuditRecords(
  database: QueryDatabase,
  query: McpAuditQuery = {},
): McpAuditPage {
  const limit = Math.max(1, Math.min(query.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE))
  const cursor = query.cursor ? decodeCursor(query.cursor) : null
  const conditions = [
    query.callerChatId ? eq(mcpAuditRecords.callerChatId, query.callerChatId) : undefined,
    query.toolName ? eq(mcpAuditRecords.toolName, query.toolName) : undefined,
    query.decision ? eq(mcpAuditRecords.status, query.decision) : undefined,
    query.from ? gte(mcpAuditRecords.createdAt, query.from) : undefined,
    query.to ? lte(mcpAuditRecords.createdAt, query.to) : undefined,
    cursor
      ? or(
          lt(mcpAuditRecords.createdAt, cursor.occurredAt),
          and(eq(mcpAuditRecords.createdAt, cursor.occurredAt), lt(mcpAuditRecords.id, cursor.id)),
        )
      : undefined,
  ]
  const rows = database
    .select()
    .from(mcpAuditRecords)
    .where(and(...conditions))
    .orderBy(desc(mcpAuditRecords.createdAt), desc(mcpAuditRecords.id))
    .limit(limit + 1)
    .all()
  const page = rows.slice(0, limit).map(toAuditDto)

  return {
    entries: page,
    nextCursor: rows.length > limit && page.length > 0 ? encodeCursor(page.at(-1)!) : null,
  }
}

function toAuditDto(row: typeof mcpAuditRecords.$inferSelect): McpAuditRecordDto {
  return {
    id: row.id,
    invocationId: row.invocationId,
    decision: row.status as McpAuditStatus,
    callerChatId: row.callerChatId,
    callerRunId: row.callerRunId,
    toolName: row.toolName,
    tier: row.tier as McpRiskTier,
    durationMs: row.durationMs,
    occurredAt: (row.createdAt ?? new Date(0)).toISOString(),
    detail: {
      callerSummary: row.callerSnapshot,
      chatSummary: row.chatSnapshot,
      runSummary: row.runSnapshot,
      inputSummary: row.inputSummary,
      resultSummary: row.resultSummary,
    },
  }
}

function encodeCursor(entry: McpAuditRecordDto): string {
  return Buffer.from(
    JSON.stringify({ occurredAt: entry.occurredAt, id: entry.id }),
    "utf8",
  ).toString("base64url")
}

function decodeCursor(cursor: string): { occurredAt: Date; id: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as { occurredAt?: unknown }).occurredAt !== "string" ||
      typeof (parsed as { id?: unknown }).id !== "string"
    ) {
      throw new Error("invalid cursor")
    }
    const occurredAt = new Date((parsed as { occurredAt: string }).occurredAt)
    if (Number.isNaN(occurredAt.getTime())) throw new Error("invalid cursor")
    return { occurredAt, id: (parsed as { id: string }).id }
  } catch {
    throw new Error("Invalid audit cursor")
  }
}

function redactValue(value: unknown, depth: number): unknown {
  if (isSafeAuditLiteral(value)) return value.value
  if (depth >= MAX_DEPTH) return truncated
  if (value === null || typeof value === "boolean" || typeof value === "number") return value
  if (typeof value === "string") return summarizeText(value)
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "undefined") return "[UNDEFINED]"
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value))
    return value.slice(0, MAX_ENTRIES).map((item) => redactValue(item, depth + 1))
  if (typeof value === "object") {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value).slice(0, MAX_ENTRIES)) {
      const outputKey = safeAuditKeys.has(key)
        ? key
        : `field_${createHash("sha256").update(key).digest("hex").slice(0, 16)}`
      output[outputKey] = isSafeAuditLiteral(item)
        ? item.value
        : isSafeCapabilityFlag(key, item)
          ? item
          : isSafeAuthorityNumber(key, item)
            ? item
            : secretKey.test(key) || reasoningKey.test(key)
              ? redacted
              : isSafeDigestField(key, item)
                ? item
                : redactValue(item, depth + 1)
    }
    return output
  }
  return String(value)
}

function safeLiteral(value: string): SafeAuditLiteral {
  return { value, [safeLiteralMarker]: true }
}

function isSafeAuditLiteral(value: unknown): value is SafeAuditLiteral {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as Partial<SafeAuditLiteral>)[safeLiteralMarker] === true &&
    typeof (value as Partial<SafeAuditLiteral>).value === "string",
  )
}

function isSafeCapabilityFlag(key: string, value: unknown): value is boolean {
  return (
    typeof value === "boolean" &&
    [
      "projectWrite",
      "shell",
      "network",
      "git",
      "browser",
      "secrets",
      "subagents",
      "thirdPartyMcp",
      "productMcpRead",
      "productMcpWrite",
      "productMcpTier3",
    ].includes(key)
  )
}

function isSafeAuthorityNumber(key: string, value: unknown): value is number {
  return (
    typeof value === "number" &&
    [
      "agentCount",
      "dependencyCount",
      "maxBlockers",
      "maxCostUsdMicros",
      "maxDepth",
      "maxFailures",
      "maxParallelAgents",
      "maxTotalTokens",
      "maxWallClockMs",
      "targetCompletedAgents",
      "targetProgressPercent",
    ].includes(key)
  )
}

function isSafeDigestField(key: string, value: unknown): value is string {
  return (
    (key === "sha256" || key === "contextHash") &&
    typeof value === "string" &&
    /^[a-f0-9]{64}$/i.test(value)
  )
}

/**
 * Returns a durable claim with no terminal audit for the same caller, tool,
 * and redacted input. Callers must reconcile it instead of blindly retrying.
 */
export function findUnresolvedMcpDispatch(
  database: RecoveryDatabase,
  lookup: McpDispatchLookup,
): McpDispatchBlock | null {
  return database.transaction((tx) => {
    const rows = tx
      .select()
      .from(mcpAuditRecords)
      .where(
        and(
          eq(mcpAuditRecords.callerChatId, lookup.caller.chatId),
          lookup.caller.runId
            ? eq(mcpAuditRecords.callerRunId, lookup.caller.runId)
            : isNull(mcpAuditRecords.callerRunId),
          eq(mcpAuditRecords.toolName, lookup.toolName),
        ),
      )
      .orderBy(desc(mcpAuditRecords.createdAt), desc(mcpAuditRecords.id))
      .all()
    const inputSummary = redactMcpAuditSummary(
      summarizeMcpAuditInput(lookup.toolName, lookup.input),
    )
    const claim = activeRecoveryClaims(rows).find((row) => row.inputSummary === inputSummary)
    if (!claim) return null
    if (claim.state === "retry-authorized" && claim.invocationId !== lookup.invocationId) {
      appendRecoveryEvent(tx, claim, "retry-consumed", {
        sha256: invocationDigest(lookup.invocationId),
        state: "retry-consumed",
      })
      return null
    }
    return {
      invocationId: claim.invocationId,
      state: claim.state,
      relation: claim.invocationId === lookup.invocationId ? "same-invocation" : "matching-retry",
    }
  })
}

export function recoverMcpDispatchClaims(
  database: RecoveryDatabase,
  options: { staleAfterMs?: number; limit?: number; now?: Date } = {},
): number {
  const now = options.now ?? new Date()
  const staleBefore = now.getTime() - (options.staleAfterMs ?? 30_000)
  const limit = Math.max(1, Math.min(options.limit ?? 100, 100))
  const rows = database
    .select()
    .from(mcpAuditRecords)
    .orderBy(desc(mcpAuditRecords.createdAt))
    .all()
  const candidates = activeRecoveryClaims(rows)
    .filter((claim) => claim.state === "dispatch-started")
    .filter((claim) => (claim.createdAt?.getTime() ?? 0) <= staleBefore)
    .slice(0, limit)
  let recovered = 0
  for (const candidate of candidates) {
    database.transaction((tx) => {
      const invocationRows = tx
        .select()
        .from(mcpAuditRecords)
        .where(eq(mcpAuditRecords.invocationId, candidate.invocationId))
        .orderBy(desc(mcpAuditRecords.createdAt), desc(mcpAuditRecords.id))
        .all()
      const current = activeRecoveryClaims(invocationRows)[0]
      if (!current || current.state !== "dispatch-started") return
      const retrySafe = isRetrySafeClaim(current)
      const priorConsumed = rows.some(
        (row) =>
          row.invocationId !== current.invocationId &&
          row.callerChatId === current.callerChatId &&
          row.callerRunId === current.callerRunId &&
          row.toolName === current.toolName &&
          row.inputSummary === current.inputSummary &&
          row.status === "retry-consumed",
      )
      appendRecoveryEvent(
        tx,
        current,
        retrySafe
          ? priorConsumed
            ? "recovery-exhausted"
            : "recovery-retryable"
          : "recovery-unknown",
        { retrySafe, boundedRetryUsed: priorConsumed },
      )
      recovered += 1
    })
  }
  return recovered
}

export function listMcpDispatchRecoveryClaims(database: QueryDatabase): McpDispatchRecoveryClaim[] {
  const rows = database
    .select()
    .from(mcpAuditRecords)
    .orderBy(desc(mcpAuditRecords.createdAt))
    .all()
  return activeRecoveryClaims(rows).map((claim) => ({
    invocationId: claim.invocationId,
    callerChatId: claim.callerChatId,
    callerRunId: claim.callerRunId,
    toolName: claim.toolName,
    tier: claim.tier as McpRiskTier,
    state: claim.state,
    retrySafe: isRetrySafeClaim(claim),
    createdAt: (claim.createdAt ?? new Date(0)).toISOString(),
  }))
}

export function authorizeMcpDispatchRetry(
  database: RecoveryDatabase,
  invocationId: string,
): boolean {
  return database.transaction((tx) => {
    const rows = tx
      .select()
      .from(mcpAuditRecords)
      .where(eq(mcpAuditRecords.invocationId, invocationId))
      .orderBy(desc(mcpAuditRecords.createdAt), desc(mcpAuditRecords.id))
      .all()
    const claim = activeRecoveryClaims(rows)[0]
    if (!claim || claim.state !== "recovery-retryable" || !isRetrySafeClaim(claim)) return false
    appendRecoveryEvent(tx, claim, "retry-authorized", { authorized: true })
    return true
  })
}

export function reconcileMcpDispatchClaim(
  database: RecoveryDatabase,
  invocationId: string,
  outcome: "completed" | "failed",
): boolean {
  return database.transaction((tx) => {
    const rows = tx
      .select()
      .from(mcpAuditRecords)
      .where(eq(mcpAuditRecords.invocationId, invocationId))
      .orderBy(desc(mcpAuditRecords.createdAt), desc(mcpAuditRecords.id))
      .all()
    const claim = activeRecoveryClaims(rows)[0]
    if (!claim) return false
    appendRecoveryEvent(
      tx,
      claim,
      outcome === "completed" ? "reconciled-completed" : "reconciled-failed",
      { externallyVerifiedOutcome: outcome },
    )
    return true
  })
}

type AuditRow = typeof mcpAuditRecords.$inferSelect

function activeRecoveryClaims(rows: AuditRow[]): Array<AuditRow & { state: McpAuditStatus }> {
  const grouped = new Map<string, AuditRow[]>()
  for (const row of rows) {
    const group = grouped.get(row.invocationId) ?? []
    group.push(row)
    grouped.set(row.invocationId, group)
  }
  const terminal = new Set<McpAuditStatus>([
    "completed",
    "failed",
    "reconciled-completed",
    "reconciled-failed",
  ])
  const claims: Array<AuditRow & { state: McpAuditStatus }> = []
  for (const group of grouped.values()) {
    const statuses = group.map((row) => row.status as McpAuditStatus)
    if (statuses.some((status) => terminal.has(status))) continue
    const consumed = group.find((row) => row.status === "retry-consumed")
    const successorDigest = consumed ? resultDigest(consumed.resultSummary) : null
    if (
      successorDigest &&
      rows.some(
        (row) =>
          invocationDigest(row.invocationId) === successorDigest &&
          (row.status === "dispatch-started" || terminal.has(row.status as McpAuditStatus)),
      )
    ) {
      continue
    }
    const dispatch = group.find((row) => row.status === "dispatch-started")
    if (!dispatch) continue
    const latestLifecycle = group.find((row) =>
      [
        "recovery-retryable",
        "recovery-unknown",
        "retry-authorized",
        "retry-consumed",
        "recovery-exhausted",
      ].includes(row.status),
    )
    claims.push({
      ...dispatch,
      state: (latestLifecycle?.status ?? "dispatch-started") as McpAuditStatus,
    })
  }
  return claims
}

function invocationDigest(invocationId: string): string {
  return createHash("sha256").update(invocationId).digest("hex")
}

function resultDigest(summary: string): string | null {
  try {
    const parsed = JSON.parse(summary) as { sha256?: unknown }
    return typeof parsed.sha256 === "string" && /^[a-f0-9]{64}$/.test(parsed.sha256)
      ? parsed.sha256
      : null
  } catch {
    return null
  }
}

function isRetrySafeClaim(claim: Pick<AuditRow, "tier" | "toolName" | "inputSummary">): boolean {
  if (claim.tier === 0) return true
  if (
    claim.toolName === "create_automation_draft" ||
    claim.toolName === "update_automation" ||
    claim.toolName === "enable_automation" ||
    claim.toolName === "propose_task" ||
    claim.toolName === "update_task_proposal" ||
    claim.toolName === "cancel_task_proposal"
  ) {
    return true
  }
  try {
    const input = JSON.parse(claim.inputSummary) as Record<string, unknown>
    if (claim.toolName === "launch_run" || claim.toolName === "wait_for_chats") {
      return Object.prototype.hasOwnProperty.call(input, "idempotencyKey")
    }
    return false
  } catch {
    return false
  }
}

function appendRecoveryEvent(
  database: AuditDatabase,
  source: AuditRow,
  status: McpAuditStatus,
  result: unknown,
): void {
  database
    .insert(mcpAuditRecords)
    .values({
      invocationId: source.invocationId,
      status,
      callerChatId: source.callerChatId,
      callerRunId: source.callerRunId,
      toolName: source.toolName,
      tier: source.tier,
      callerSnapshot: source.callerSnapshot,
      chatSnapshot: source.chatSnapshot,
      runSnapshot: source.runSnapshot,
      inputSummary: source.inputSummary,
      resultSummary: redactMcpAuditSummary(result),
      durationMs: source.durationMs,
      createdAt: new Date(),
    })
    .run()
}

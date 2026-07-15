import Database from "better-sqlite3"
import { createHash, randomUUID } from "node:crypto"
import { drizzle } from "drizzle-orm/better-sqlite3"
import {
  usageBudgetContextSchema,
  usageBudgetCreateSchema,
  usageBudgetPolicyDtoSchema,
  usageBudgetUpdateSchema,
  type UsageBudgetContext,
  type UsageBudgetCreate,
  type UsageBudgetPolicyDto,
  type UsageBudgetScope,
  type UsageBudgetUpdate,
} from "../../../shared/advanced-usage"
import type { AgentHarness } from "../../../shared/harness-types"
import * as schema from "../db/schema"
import { appendMcpAuditRecord } from "../mcp-control/audit-storage"
import { queryUsageInsights } from "./insights"
import { queryUsageRollups, type UsageRollupValue } from "./rollups"
import type { UsageDb } from "./store"

type Sqlite = Database.Database
type Row = Record<string, unknown>

const ALERT_PROVIDER_ID = "flapstack-budget"
const REARM_RATIO = 0.9
const scopePrecedence: Record<UsageBudgetScope["type"], number> = {
  global: 0,
  "provider-account": 1,
  project: 2,
  task: 3,
  orchestration: 4,
  automation: 5,
}

export type UsageBudgetEvaluation = {
  policy: UsageBudgetPolicyDto
  precedence: number
  observedValue: number | null
  thresholdValue: number
  exceeded: boolean
  quality: UsageRollupValue["quality"]
  window: { fromMs: number; toMs: number; resetKey: string }
  sourceClasses: string[]
  factIds: string[]
  externalOnly: boolean
  overridden: boolean
}

export type UsageBudgetDecision = {
  context: UsageBudgetContext
  blocked: boolean
  evaluations: UsageBudgetEvaluation[]
  hardStops: UsageBudgetEvaluation[]
  softAlerts: UsageBudgetEvaluation[]
  overrideRequired: { budgetIds: string[]; maxDurationMs: number; maxLaunches: 1 } | null
}

export class UsageBudgetExceededError extends Error {
  constructor(readonly decision: UsageBudgetDecision) {
    super("Usage budget exhausted before controlled launch.")
    this.name = "UsageBudgetExceededError"
  }
}

type OverrideGrant = {
  budgetIds: Set<string>
  contextKey: string
  expiresAt: number
  launchesRemaining: number
  boundRunIds: Set<string>
}

const overrideGrants = new Map<string, OverrideGrant>()

export function listUsageBudgets(db: UsageDb, enabledOnly = false): UsageBudgetPolicyDto[] {
  const sqlite = rawClient(db)
  const rows = sqlite
    .prepare(
      `SELECT * FROM usage_budgets
       ${enabledOnly ? "WHERE enabled = 1" : ""}
       ORDER BY enabled DESC, updated_at DESC, id`,
    )
    .all() as Row[]
  return rows.map(policyFromRow)
}

export function getUsageBudget(db: UsageDb, id: string): UsageBudgetPolicyDto | null {
  const row = rawClient(db).prepare("SELECT * FROM usage_budgets WHERE id = ?").get(id) as
    Row | undefined
  return row ? policyFromRow(row) : null
}

export function createUsageBudget(
  db: UsageDb,
  inputValue: UsageBudgetCreate,
  options: { id?: string; nowMs?: number; callerChatId?: string } = {},
): UsageBudgetPolicyDto {
  const input = usageBudgetCreateSchema.parse(inputValue)
  assertResetTimezone(input)
  const id = options.id ?? randomUUID()
  const nowMs = options.nowMs ?? Date.now()
  const sqlite = rawClient(db)
  const values = policyColumns(input)
  sqlite
    .prepare(
      `INSERT INTO usage_budgets (
        id, name, enabled, scope_type, provider_id, account_tag, project_id, task_id,
        automation_id, orchestration_id, threshold_type, threshold_value, action,
        reset_type, reset_timezone, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(id, ...values, epochSeconds(nowMs), epochSeconds(nowMs))
  const policy = requireUsageBudget(db, id)
  appendBudgetAudit(db, {
    status: "completed",
    action: "create",
    callerChatId: options.callerChatId,
    policy,
  })
  return policy
}

export function updateUsageBudget(
  db: UsageDb,
  inputValue: UsageBudgetUpdate,
  options: { nowMs?: number; callerChatId?: string } = {},
): UsageBudgetPolicyDto {
  const input = usageBudgetUpdateSchema.parse(inputValue)
  const current = requireUsageBudget(db, input.id)
  if (current.version !== input.expectedVersion) throw new Error("Usage budget version conflict.")
  const nextInput = usageBudgetCreateSchema.parse({
    name: input.name ?? current.name,
    enabled: input.enabled ?? current.enabled,
    scope: input.scope ?? current.scope,
    threshold: input.threshold ?? current.threshold,
    action: input.action ?? current.action,
    reset: input.reset ?? current.reset,
  })
  assertResetTimezone(nextInput)
  const values = policyColumns(nextInput)
  const sqlite = rawClient(db)
  const transaction = sqlite.transaction(() => {
    const result = sqlite
      .prepare(
        `UPDATE usage_budgets SET
          name = ?, enabled = ?, scope_type = ?, provider_id = ?, account_tag = ?,
          project_id = ?, task_id = ?, automation_id = ?, orchestration_id = ?,
          threshold_type = ?, threshold_value = ?, action = ?, reset_type = ?,
          reset_timezone = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND version = ?`,
      )
      .run(...values, epochSeconds(options.nowMs ?? Date.now()), input.id, input.expectedVersion)
    if (result.changes !== 1) throw new Error("Usage budget version conflict.")
    clearBudgetArmState(sqlite, input.id)
  })
  transaction.immediate()
  const policy = requireUsageBudget(db, input.id)
  appendBudgetAudit(db, {
    status: "completed",
    action: "update",
    callerChatId: options.callerChatId,
    policy,
  })
  return policy
}

export function deleteUsageBudget(
  db: UsageDb,
  input: { id: string; expectedVersion: number; callerChatId?: string },
): boolean {
  const current = requireUsageBudget(db, input.id)
  const sqlite = rawClient(db)
  const transaction = sqlite.transaction(() => {
    const result = sqlite
      .prepare("DELETE FROM usage_budgets WHERE id = ? AND version = ?")
      .run(input.id, input.expectedVersion)
    if (result.changes !== 1) throw new Error("Usage budget version conflict.")
    clearBudgetArmState(sqlite, input.id)
    return true
  })
  const deleted = transaction.immediate()
  appendBudgetAudit(db, {
    status: "completed",
    action: "delete",
    callerChatId: input.callerChatId,
    policy: current,
  })
  return deleted
}

export function resolveUsageBudgets(
  db: UsageDb,
  contextValue: UsageBudgetContext,
  options: { nowMs?: number; overrideToken?: string | null } = {},
): UsageBudgetDecision {
  const context = usageBudgetContextSchema.parse(contextValue)
  const nowMs = options.nowMs ?? Date.now()
  const matching = listUsageBudgets(db, true).filter((policy) => matchesContext(policy, context))
  const effective = effectiveByPrecedence(matching)
  const evaluations = effective.map((policy) =>
    evaluatePolicy(db, policy, context, nowMs, options.overrideToken ?? null),
  )
  const hardStops = evaluations.filter(
    (evaluation) =>
      evaluation.policy.action === "hard-stop" &&
      evaluation.exceeded &&
      !evaluation.overridden &&
      context.controlled,
  )
  return {
    context,
    blocked: hardStops.length > 0,
    evaluations,
    hardStops,
    softAlerts: evaluations.filter(
      (evaluation) => evaluation.policy.action === "soft-alert" && evaluation.exceeded,
    ),
    overrideRequired: hardStops.length
      ? {
          budgetIds: hardStops.map((evaluation) => evaluation.policy.id),
          maxDurationMs: 15 * 60 * 1_000,
          maxLaunches: 1,
        }
      : null,
  }
}

export function assertUsageBudgetAllowsLaunch(
  db: UsageDb,
  context: UsageBudgetContext,
  options: { nowMs?: number; overrideToken?: string | null } = {},
): UsageBudgetDecision {
  const decision = resolveUsageBudgets(db, context, options)
  if (decision.blocked) {
    appendBudgetAudit(db, {
      status: "denied",
      action: "launch",
      callerChatId: context.runId ?? "controlled-run",
      context,
      budgetIds: decision.hardStops.map((item) => item.policy.id),
    })
    throw new UsageBudgetExceededError(decision)
  }
  return decision
}

export function resolveUsageBudgetContextForRun(sqlite: Sqlite, runId: string): UsageBudgetContext {
  const row = sqlite
    .prepare(
      `SELECT r.id run_id, r.harness, c.project_id, c.task_id,
              ao.automation_id,
              oa.task_id orchestration_id
       FROM agent_runs r
       JOIN chats c ON c.id = r.chat_id
       LEFT JOIN automation_executions ae ON ae.run_id = r.id
       LEFT JOIN automation_occurrences ao ON ao.id = ae.occurrence_id
       LEFT JOIN orchestration_agents oa ON oa.run_id = r.id
       WHERE r.id = ?`,
    )
    .get(runId) as Row | undefined
  if (!row) throw new Error("Run not found for usage budget resolution.")
  return usageBudgetContextSchema.parse({
    controlled: true,
    providerId: providerForHarness(String(row.harness)),
    accountTag: null,
    projectId: stringOrNull(row.project_id),
    taskId: stringOrNull(row.task_id),
    automationId: stringOrNull(row.automation_id),
    orchestrationId: stringOrNull(row.orchestration_id),
    runId,
  })
}

export function claimPendingRunWithinUsageBudget(
  sqlite: Sqlite,
  runId: string,
  options: { nowMs?: number; overrideToken?: string | null } = {},
): { claimed: boolean; blocked: UsageBudgetDecision | null } {
  const db = drizzle(sqlite, { schema })
  const transaction = sqlite.transaction(() => {
    const state = sqlite.prepare("SELECT status FROM agent_runs WHERE id = ?").get(runId) as
      Row | undefined
    if (state?.status !== "pending") return { claimed: false, blocked: null }
    const context = resolveUsageBudgetContextForRun(sqlite, runId)
    const decision = resolveUsageBudgets(db, context, options)
    if (decision.blocked) {
      const now = epochSeconds(options.nowMs ?? Date.now())
      sqlite
        .prepare(
          "UPDATE agent_runs SET status = 'cancelled', completed_at = ? WHERE id = ? AND status = 'pending'",
        )
        .run(now, runId)
      const row = sqlite
        .prepare("SELECT sub_chat_id FROM agent_runs WHERE id = ?")
        .get(runId) as Row
      sqlite
        .prepare("UPDATE sub_chats SET run_status = 'cancelled', updated_at = ? WHERE id = ?")
        .run(now, row.sub_chat_id)
      appendBudgetAudit(db, {
        status: "denied",
        action: "launch",
        callerChatId: context.runId ?? "controlled-run",
        context,
        budgetIds: decision.hardStops.map((item) => item.policy.id),
      })
      return { claimed: false, blocked: decision }
    }
    const claimed = sqlite
      .prepare(
        `UPDATE agent_runs SET status = 'running'
         WHERE id = ? AND status = 'pending'
           AND NOT EXISTS (
             SELECT 1 FROM agent_runs active
             WHERE active.sub_chat_id = agent_runs.sub_chat_id
               AND active.status = 'running' AND active.id <> agent_runs.id
           )`,
      )
      .run(runId).changes
    if (claimed === 1 && options.overrideToken) {
      bindUsageBudgetOverrideToRun(options.overrideToken, context, runId)
    }
    return { claimed: claimed === 1, blocked: null }
  })
  return transaction.immediate()
}

export function createUsageBudgetOverride(input: {
  budgetIds: string[]
  context: UsageBudgetContext
  durationMs: number
  nowMs?: number
}): { token: string; expiresAt: number; maxLaunches: 1 } {
  const nowMs = input.nowMs ?? Date.now()
  const durationMs = Math.max(1_000, Math.min(15 * 60 * 1_000, Math.floor(input.durationMs)))
  const token = `${randomUUID()}.${randomUUID()}`
  overrideGrants.set(tokenHash(token), {
    budgetIds: new Set(input.budgetIds),
    contextKey: contextKey(input.context),
    expiresAt: nowMs + durationMs,
    launchesRemaining: 1,
    boundRunIds: new Set(),
  })
  pruneOverrides(nowMs)
  return { token, expiresAt: nowMs + durationMs, maxLaunches: 1 }
}

export function bindUsageBudgetOverrideToRun(
  token: string,
  context: UsageBudgetContext,
  runId: string,
  nowMs = Date.now(),
): boolean {
  const grant = overrideGrants.get(tokenHash(token))
  if (!grant || grant.expiresAt <= nowMs || grant.launchesRemaining < 1) return false
  if (grant.contextKey !== contextKey(context)) return false
  grant.launchesRemaining -= 1
  grant.boundRunIds.add(runId)
  return true
}

export function evaluateUsageBudgetAlerts(
  db: UsageDb,
  options: { nowMs?: number; source?: "app" | "daemon" } = {},
): { fired: number; rearmed: number } {
  const nowMs = options.nowMs ?? Date.now()
  const sqlite = rawClient(db)
  let fired = 0
  let rearmed = 0
  for (const policy of listUsageBudgets(db, true)) {
    const context = contextForPolicy(policy)
    const evaluation = evaluatePolicy(db, policy, context, nowMs, null)
    if (!evaluation.exceeded) {
      if (evaluation.observedValue !== null && rearmBudget(sqlite, evaluation, nowMs)) rearmed += 1
      continue
    }
    if (!claimBudgetAlert(sqlite, evaluation, nowMs)) continue
    const insight = advancedAlertInsight(db, evaluation, context, nowMs)
    recordBudgetAlert(sqlite, evaluation, options.source ?? "app", nowMs, insight.anomaly)
    appendBudgetAudit(db, {
      status: "completed",
      action: "alert",
      callerChatId: options.source === "daemon" ? "usage-daemon" : "flapstack-usage-alerts",
      policy,
      context,
      budgetIds: [policy.id],
      result: { ok: true, insight },
    })
    fired += 1
  }
  return { fired, rearmed }
}

export function stopRunningRunsOverUsageBudget(
  db: UsageDb,
  options: { nowMs?: number } = {},
): Array<{ runId: string; subChatId: string; harness: AgentHarness }> {
  const sqlite = rawClient(db)
  const nowMs = options.nowMs ?? Date.now()
  const rows = sqlite
    .prepare("SELECT id, sub_chat_id, harness FROM agent_runs WHERE status = 'running'")
    .all() as Row[]
  const stopped: Array<{ runId: string; subChatId: string; harness: AgentHarness }> = []
  for (const row of rows) {
    const runId = String(row.id)
    const context = resolveUsageBudgetContextForRun(sqlite, runId)
    const decision = resolveUsageBudgets(db, context, { nowMs })
    if (!decision.blocked) continue
    const transaction = sqlite.transaction(() => {
      const changed = sqlite
        .prepare(
          "UPDATE agent_runs SET status = 'cancelled', completed_at = ? WHERE id = ? AND status = 'running'",
        )
        .run(epochSeconds(nowMs), runId).changes
      if (changed !== 1) return false
      sqlite
        .prepare("UPDATE sub_chats SET run_status = 'cancelled', updated_at = ? WHERE id = ?")
        .run(epochSeconds(nowMs), row.sub_chat_id)
      return true
    })
    if (!transaction.immediate()) continue
    appendBudgetAudit(db, {
      status: "completed",
      action: "running-stop",
      callerChatId: runId,
      context,
      budgetIds: decision.hardStops.map((item) => item.policy.id),
    })
    stopped.push({
      runId,
      subChatId: String(row.sub_chat_id),
      harness: row.harness as AgentHarness,
    })
  }
  return stopped
}

export function providerForHarness(harness: string): string | null {
  if (harness === "claude-code") return "anthropic"
  if (harness === "codex") return "codex"
  if (harness === "cursor-agent") return "cursor"
  if (harness === "openrouter" || harness === "nanogpt") return harness
  if (harness === "local") return "local"
  return null
}

function evaluatePolicy(
  db: UsageDb,
  policy: UsageBudgetPolicyDto,
  context: UsageBudgetContext,
  nowMs: number,
  overrideToken: string | null,
): UsageBudgetEvaluation {
  const window = budgetWindow(rawClient(db), policy, nowMs)
  if (policy.threshold.type === "quota-percent-micros") {
    const observedValue = latestQuotaPercentMicros(rawClient(db), policy, window.fromMs, nowMs)
    return {
      policy,
      precedence: scopePrecedence[policy.scope.type],
      observedValue,
      thresholdValue: policy.threshold.value,
      exceeded: observedValue !== null && observedValue >= policy.threshold.value,
      quality: observedValue === null ? "unknown" : "provider-reported",
      window,
      sourceClasses: ["provider-account-total", "external-provider"],
      factIds: [],
      externalOnly: true,
      overridden: false,
    }
  }
  const sourceClasses =
    policy.action === "hard-stop"
      ? (["flapstack-run"] as const)
      : policy.scope.type === "provider-account"
        ? (["provider-account-total", "external-provider", "unknown"] as const)
        : undefined
  const rollup = queryUsageRollups(db, {
    scope: rollupScope(policy),
    ...(context.providerId ? { providerIds: [context.providerId] } : {}),
    ...(context.accountTag !== null ? { accountTags: [context.accountTag] } : {}),
    ...(sourceClasses ? { sourceClasses: [...sourceClasses] } : {}),
    fromMs: window.fromMs,
    toMs: window.toMs,
  })
  const observedValue = metricValue(policy, rollup.totals.metrics)
  const exceeded = observedValue !== null && observedValue >= policy.threshold.value
  return {
    policy,
    precedence: scopePrecedence[policy.scope.type],
    observedValue,
    thresholdValue: policy.threshold.value,
    exceeded,
    quality: rollup.totals.quality,
    window,
    sourceClasses: rollup.totals.sourceClasses,
    factIds: rollup.totals.factIds,
    externalOnly:
      rollup.totals.sourceClasses.length > 0 &&
      rollup.totals.sourceClasses.every((value) => value !== "flapstack-run"),
    overridden:
      exceeded && policy.action === "hard-stop"
        ? overrideApplies(overrideToken, policy.id, context, nowMs)
        : false,
  }
}

function metricValue(
  policy: UsageBudgetPolicyDto,
  metrics: {
    costUsdMicros: number | null
    costUsdEstimatedMicros: number | null
    totalTokens: number | null
    requestCount: number | null
  },
): number | null {
  if (policy.threshold.type === "total-tokens") return metrics.totalTokens
  if (policy.threshold.type === "request-count") return metrics.requestCount
  if (policy.threshold.type === "cost-usd-micros") {
    if (policy.action === "hard-stop") return metrics.costUsdMicros
    if (metrics.costUsdMicros === null && metrics.costUsdEstimatedMicros === null) return null
    return (metrics.costUsdMicros ?? 0) + (metrics.costUsdEstimatedMicros ?? 0)
  }
  return null
}

function effectiveByPrecedence(policies: UsageBudgetPolicyDto[]): UsageBudgetPolicyDto[] {
  const selected = new Map<string, UsageBudgetPolicyDto>()
  for (const policy of [...policies].sort(comparePrecedence)) {
    const key = `${policy.threshold.type}:${policy.action}`
    if (!selected.has(key)) selected.set(key, policy)
  }
  return [...selected.values()].sort(comparePrecedence)
}

function comparePrecedence(left: UsageBudgetPolicyDto, right: UsageBudgetPolicyDto): number {
  return (
    scopePrecedence[right.scope.type] - scopePrecedence[left.scope.type] ||
    right.updatedAt - left.updatedAt ||
    left.id.localeCompare(right.id)
  )
}

function matchesContext(policy: UsageBudgetPolicyDto, context: UsageBudgetContext): boolean {
  switch (policy.scope.type) {
    case "global":
      return true
    case "provider-account":
      return (
        context.providerId === policy.scope.providerId &&
        (policy.scope.accountTag === null || context.accountTag === policy.scope.accountTag)
      )
    case "project":
      return context.projectId === policy.scope.projectId
    case "task":
      return context.taskId === policy.scope.taskId
    case "automation":
      return context.automationId === policy.scope.automationId
    case "orchestration":
      return context.orchestrationId === policy.scope.orchestrationId
  }
}

function rollupScope(policy: UsageBudgetPolicyDto) {
  switch (policy.scope.type) {
    case "global":
      return { type: "global" as const }
    case "provider-account":
      return {
        type: "provider-account" as const,
        providerId: policy.scope.providerId,
        accountTag: policy.scope.accountTag ?? "",
      }
    case "project":
      return { type: "project" as const, id: policy.scope.projectId }
    case "task":
      return { type: "task" as const, id: policy.scope.taskId }
    case "automation":
      return { type: "automation" as const, id: policy.scope.automationId }
    case "orchestration":
      return { type: "orchestration" as const, id: policy.scope.orchestrationId }
  }
}

function budgetWindow(
  sqlite: Sqlite,
  policy: UsageBudgetPolicyDto,
  nowMs: number,
): { fromMs: number; toMs: number; resetKey: string } {
  if (policy.reset.type === "none") return { fromMs: 0, toMs: nowMs + 1, resetKey: "none" }
  if (policy.reset.type === "provider-cycle" && policy.scope.type === "provider-account") {
    const row = sqlite
      .prepare(
        `SELECT cycle_start, cycle_end, reset_at FROM usage_cycles
         WHERE provider_id = ? AND (? IS NULL OR account_tag = ?)
         ORDER BY COALESCE(cycle_end, reset_at, cycle_start) DESC LIMIT 1`,
      )
      .get(policy.scope.providerId, policy.scope.accountTag, policy.scope.accountTag) as
      Row | undefined
    const fromMs = epochMs(row?.cycle_start) ?? 0
    const toMs = Math.min(epochMs(row?.cycle_end) ?? epochMs(row?.reset_at) ?? nowMs + 1, nowMs + 1)
    return { fromMs, toMs: Math.max(fromMs + 1, toMs), resetKey: `provider:${fromMs}` }
  }
  if (policy.reset.type === "provider-cycle") {
    throw new Error("Provider-cycle budget requires provider-account scope.")
  }
  const timezone = policy.reset.timezone
  const local = zonedParts(nowMs, timezone)
  if (policy.reset.type === "daily") local.hour = 0
  if (policy.reset.type === "weekly") {
    local.hour = 0
    const weekday = (new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay() + 6) % 7
    local.day -= weekday
  }
  if (policy.reset.type === "monthly") {
    local.day = 1
    local.hour = 0
  }
  const fromMs = zonedLocalToUtc(normalizeLocal(local), timezone)
  return { fromMs, toMs: nowMs + 1, resetKey: `${policy.reset.type}:${fromMs}` }
}

function latestQuotaPercentMicros(
  sqlite: Sqlite,
  policy: UsageBudgetPolicyDto,
  fromMs: number,
  toMs: number,
): number | null {
  if (policy.scope.type !== "provider-account") return null
  const row = sqlite
    .prepare(
      `SELECT percent_used, quota_used, quota_limit FROM usage_samples
       WHERE provider_id = ? AND (? IS NULL OR account_tag = ?)
         AND (CASE WHEN captured_at > 9999999999 THEN captured_at ELSE captured_at * 1000 END) >= ?
         AND (CASE WHEN captured_at > 9999999999 THEN captured_at ELSE captured_at * 1000 END) < ?
       ORDER BY captured_at DESC, id DESC LIMIT 1`,
    )
    .get(
      policy.scope.providerId,
      policy.scope.accountTag,
      policy.scope.accountTag,
      fromMs,
      toMs,
    ) as Row | undefined
  const percent = finiteNumber(row?.percent_used)
  if (percent !== null) return Math.round(percent * 1_000_000)
  const used = finiteNumber(row?.quota_used)
  const limit = finiteNumber(row?.quota_limit)
  return used !== null && limit !== null && limit > 0
    ? Math.round((used / limit) * 100_000_000)
    : null
}

function claimBudgetAlert(
  sqlite: Sqlite,
  evaluation: UsageBudgetEvaluation,
  nowMs: number,
): boolean {
  const transaction = sqlite.transaction(() => {
    const row = sqlite
      .prepare(
        `SELECT armed, last_fired_at FROM usage_alert_arm_states
         WHERE provider_id = ? AND account_tag = ? AND alert_type = ? AND threshold_value = ?`,
      )
      .get(
        ALERT_PROVIDER_ID,
        evaluation.policy.id,
        evaluation.policy.action,
        evaluation.thresholdValue,
      ) as Row | undefined
    const reset =
      row &&
      evaluation.window.fromMs > 0 &&
      (epochMs(row.last_fired_at) ?? 0) < evaluation.window.fromMs
    if (row && !Boolean(row.armed) && !reset) return false
    if (!row) {
      sqlite
        .prepare(
          `INSERT INTO usage_alert_arm_states
           (id, provider_id, account_tag, alert_type, threshold_value, armed, last_fired_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .run(
          randomUUID(),
          ALERT_PROVIDER_ID,
          evaluation.policy.id,
          evaluation.policy.action,
          evaluation.thresholdValue,
          epochSeconds(nowMs),
          epochSeconds(nowMs),
        )
    } else {
      sqlite
        .prepare(
          `UPDATE usage_alert_arm_states SET armed = 0, last_fired_at = ?, updated_at = ?
           WHERE provider_id = ? AND account_tag = ? AND alert_type = ? AND threshold_value = ?`,
        )
        .run(
          epochSeconds(nowMs),
          epochSeconds(nowMs),
          ALERT_PROVIDER_ID,
          evaluation.policy.id,
          evaluation.policy.action,
          evaluation.thresholdValue,
        )
    }
    return true
  })
  return transaction.immediate()
}

function rearmBudget(sqlite: Sqlite, evaluation: UsageBudgetEvaluation, nowMs: number): boolean {
  if (
    evaluation.observedValue === null ||
    evaluation.observedValue >= evaluation.thresholdValue * REARM_RATIO
  ) {
    return false
  }
  const result = sqlite
    .prepare(
      `UPDATE usage_alert_arm_states SET armed = 1, last_fired_at = NULL, updated_at = ?
       WHERE provider_id = ? AND account_tag = ? AND alert_type = ? AND threshold_value = ?
         AND armed = 0`,
    )
    .run(
      epochSeconds(nowMs),
      ALERT_PROVIDER_ID,
      evaluation.policy.id,
      evaluation.policy.action,
      evaluation.thresholdValue,
    )
  return result.changes === 1
}

function recordBudgetAlert(
  sqlite: Sqlite,
  evaluation: UsageBudgetEvaluation,
  source: "app" | "daemon",
  nowMs: number,
  anomaly: "normal" | "spike" | "possible-spike" | "unavailable",
): void {
  sqlite
    .prepare(
      `INSERT INTO usage_alert_events (
        id, provider_id, account_tag, alert_type, threshold_value, observed_value,
        cost_quality, channel, delivery_status, message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?)`,
    )
    .run(
      randomUUID(),
      ALERT_PROVIDER_ID,
      evaluation.policy.id,
      `budget-${evaluation.policy.action}`,
      evaluation.thresholdValue,
      evaluation.observedValue,
      evaluation.quality,
      source,
      evaluation.externalOnly
        ? "External provider usage crossed a soft budget; Flapstack did not stop it."
        : evaluation.policy.action === "hard-stop"
          ? `Controlled usage crossed a hard budget${anomaly === "spike" ? " with a confirmed spend spike" : ""}.`
          : `Usage crossed a soft budget${anomaly === "spike" ? " with a confirmed spend spike" : ""}.`,
      epochSeconds(nowMs),
    )
}

function advancedAlertInsight(
  db: UsageDb,
  evaluation: UsageBudgetEvaluation,
  context: UsageBudgetContext,
  nowMs: number,
): {
  anomaly: "normal" | "spike" | "possible-spike" | "unavailable"
  burnRate: "available" | "range" | "unavailable"
  factIds: string[]
} {
  if (evaluation.policy.threshold.type === "quota-percent-micros") {
    return { anomaly: "unavailable", burnRate: "unavailable", factIds: [] }
  }
  const recentFromMs = Math.max(evaluation.window.fromMs, nowMs - 30 * 24 * 60 * 60 * 1_000)
  if (nowMs <= recentFromMs) {
    return { anomaly: "unavailable", burnRate: "unavailable", factIds: [] }
  }
  const sourceClasses =
    evaluation.policy.action === "hard-stop"
      ? (["flapstack-run"] as const)
      : evaluation.policy.scope.type === "provider-account"
        ? (["provider-account-total", "external-provider", "unknown"] as const)
        : undefined
  const insight = queryUsageInsights(db, {
    rollup: {
      scope: rollupScope(evaluation.policy),
      ...(context.providerId ? { providerIds: [context.providerId] } : {}),
      ...(context.accountTag !== null ? { accountTags: [context.accountTag] } : {}),
      ...(sourceClasses ? { sourceClasses: [...sourceClasses] } : {}),
      fromMs: recentFromMs,
      toMs: nowMs,
    },
    metric: evaluation.policy.threshold.type,
    nowMs,
    coverage: { minSamples: 2, minBuckets: 2, minRatio: 0.1 },
  })
  return {
    anomaly: insight.anomaly.status,
    burnRate: insight.burnRate.status,
    factIds: insight.provenance.factIds,
  }
}

function contextForPolicy(policy: UsageBudgetPolicyDto): UsageBudgetContext {
  return usageBudgetContextSchema.parse({
    controlled: policy.scope.type !== "provider-account",
    providerId: policy.scope.type === "provider-account" ? policy.scope.providerId : null,
    accountTag: policy.scope.type === "provider-account" ? policy.scope.accountTag : null,
    projectId: policy.scope.type === "project" ? policy.scope.projectId : null,
    taskId: policy.scope.type === "task" ? policy.scope.taskId : null,
    automationId: policy.scope.type === "automation" ? policy.scope.automationId : null,
    orchestrationId: policy.scope.type === "orchestration" ? policy.scope.orchestrationId : null,
    runId: null,
  })
}

function overrideApplies(
  token: string | null,
  budgetId: string,
  context: UsageBudgetContext,
  nowMs: number,
): boolean {
  if (context.runId) {
    for (const grant of overrideGrants.values()) {
      if (
        grant.expiresAt > nowMs &&
        grant.budgetIds.has(budgetId) &&
        grant.boundRunIds.has(context.runId)
      ) {
        return true
      }
    }
  }
  if (!token) return false
  const grant = overrideGrants.get(tokenHash(token))
  return Boolean(
    grant &&
    grant.expiresAt > nowMs &&
    grant.launchesRemaining > 0 &&
    grant.budgetIds.has(budgetId) &&
    grant.contextKey === contextKey(context),
  )
}

function policyColumns(input: UsageBudgetCreate): unknown[] {
  const scope = {
    scopeType: input.scope.type,
    providerId: input.scope.type === "provider-account" ? input.scope.providerId : null,
    accountTag: input.scope.type === "provider-account" ? input.scope.accountTag : null,
    projectId: input.scope.type === "project" ? input.scope.projectId : null,
    taskId: input.scope.type === "task" ? input.scope.taskId : null,
    automationId: input.scope.type === "automation" ? input.scope.automationId : null,
    orchestrationId: input.scope.type === "orchestration" ? input.scope.orchestrationId : null,
  }
  return [
    input.name,
    input.enabled ? 1 : 0,
    scope.scopeType,
    scope.providerId,
    scope.accountTag,
    scope.projectId,
    scope.taskId,
    scope.automationId,
    scope.orchestrationId,
    input.threshold.type,
    input.threshold.value,
    input.action,
    input.reset.type,
    input.reset.type === "daily" || input.reset.type === "weekly" || input.reset.type === "monthly"
      ? input.reset.timezone
      : null,
  ]
}

function policyFromRow(row: Row): UsageBudgetPolicyDto {
  const scope = scopeFromRow(row)
  const reset =
    row.reset_type === "daily" || row.reset_type === "weekly" || row.reset_type === "monthly"
      ? { type: row.reset_type, timezone: String(row.reset_timezone) }
      : { type: String(row.reset_type) }
  return usageBudgetPolicyDtoSchema.parse({
    id: String(row.id),
    name: String(row.name),
    enabled: Boolean(row.enabled),
    scope,
    threshold: { type: String(row.threshold_type), value: Number(row.threshold_value) },
    action: String(row.action),
    reset,
    version: Number(row.version),
    createdAt: epochMs(row.created_at) ?? 0,
    updatedAt: epochMs(row.updated_at) ?? 0,
  })
}

function scopeFromRow(row: Row): UsageBudgetScope {
  switch (row.scope_type) {
    case "global":
      return { type: "global" }
    case "provider-account":
      return {
        type: "provider-account",
        providerId: String(row.provider_id),
        accountTag: stringOrNull(row.account_tag),
      }
    case "project":
      return { type: "project", projectId: String(row.project_id) }
    case "task":
      return { type: "task", taskId: String(row.task_id) }
    case "automation":
      return { type: "automation", automationId: String(row.automation_id) }
    case "orchestration":
      return { type: "orchestration", orchestrationId: String(row.orchestration_id) }
    default:
      throw new Error("Invalid persisted usage budget scope.")
  }
}

function requireUsageBudget(db: UsageDb, id: string): UsageBudgetPolicyDto {
  const policy = getUsageBudget(db, id)
  if (!policy) throw new Error("Usage budget not found.")
  return policy
}

function clearBudgetArmState(sqlite: Sqlite, id: string): void {
  sqlite
    .prepare("DELETE FROM usage_alert_arm_states WHERE provider_id = ? AND account_tag = ?")
    .run(ALERT_PROVIDER_ID, id)
}

function appendBudgetAudit(
  db: UsageDb,
  input: {
    status: "completed" | "denied" | "approval-required" | "failed"
    action: string
    callerChatId?: string
    policy?: UsageBudgetPolicyDto
    context?: UsageBudgetContext
    budgetIds?: string[]
    result?: unknown
  },
): void {
  appendMcpAuditRecord(db, {
    status: input.status,
    caller: { chatId: input.callerChatId ?? "flapstack-usage-budgets" },
    toolName: `usage_budget.${input.action}`,
    tier: input.action === "override" ? 3 : 2,
    input: {
      budgetIds: input.budgetIds ?? (input.policy ? [input.policy.id] : []),
      scope: input.policy?.scope ?? input.context ?? null,
      threshold: input.policy?.threshold ?? null,
      action: input.policy?.action ?? input.action,
    },
    result: input.result ?? { ok: input.status === "completed" },
  })
}

export function appendUsageBudgetOverrideAudit(
  db: UsageDb,
  input: {
    status: "approval-required" | "completed" | "denied" | "failed"
    callerChatId: string
    callerRunId?: string | null
    budgetIds: string[]
    context: UsageBudgetContext
    durationMs: number
  },
): void {
  appendMcpAuditRecord(db, {
    status: input.status,
    caller: { chatId: input.callerChatId, runId: input.callerRunId ?? undefined },
    toolName: "usage_budget.override",
    tier: 3,
    input: {
      budgetIds: input.budgetIds,
      scope: input.context,
      durationMs: input.durationMs,
    },
    result: { ok: input.status === "completed", status: input.status },
  })
}

function assertResetTimezone(input: UsageBudgetCreate): void {
  if (
    input.reset.type !== "daily" &&
    input.reset.type !== "weekly" &&
    input.reset.type !== "monthly"
  ) {
    return
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.reset.timezone }).format(0)
  } catch {
    throw new Error("Usage budget reset timezone must be a valid IANA timezone.")
  }
}

function contextKey(context: UsageBudgetContext): string {
  return JSON.stringify({
    providerId: context.providerId,
    accountTag: context.accountTag,
    projectId: context.projectId,
    taskId: context.taskId,
    automationId: context.automationId,
    orchestrationId: context.orchestrationId,
  })
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

function pruneOverrides(nowMs: number): void {
  for (const [key, grant] of overrideGrants) {
    if (grant.expiresAt <= nowMs) overrideGrants.delete(key)
  }
}

function rawClient(db: UsageDb): Sqlite {
  return (db as unknown as { $client: Sqlite }).$client
}

function epochSeconds(ms: number): number {
  return Math.floor(ms / 1_000)
}

function epochMs(value: unknown): number | null {
  if (value instanceof Date) return value.getTime()
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return value < 10_000_000_000 ? value * 1_000 : value
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function zonedParts(timestampMs: number, timezone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA-u-hc-h23", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(timestampMs)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  )
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
  }
}

function zonedLocalToUtc(
  local: { year: number; month: number; day: number; hour: number },
  timezone: string,
): number {
  const target = Date.UTC(local.year, local.month - 1, local.day, local.hour)
  let guess = target
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = zonedParts(guess, timezone)
    const actualLocal = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour)
    const adjustment = target - actualLocal
    if (adjustment === 0) return guess
    guess += adjustment
  }
  return guess
}

function normalizeLocal(local: { year: number; month: number; day: number; hour: number }) {
  const date = new Date(Date.UTC(local.year, local.month - 1, local.day, local.hour))
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
  }
}

import type Database from "better-sqlite3"
import { openAppDatabase } from "../db/access"
import { createHash, randomUUID } from "node:crypto"
import {
  automationDraftSchema,
  type AutomationDraft,
  type AutomationScope,
  type AutomationTrigger,
} from "../../../shared/automation"
import { customPermissionCapabilityKeys } from "../../../shared/permission-capabilities"
import { parseJsonText } from "../json"

const PAGE_MAX = 100

export type AutomationControlActor =
  { type: "user"; id: string } | { type: "agent"; chatId: string; runId?: string }

export type AutomationApprovalContext = {
  approvedBy: string
  auditId: string
}

export type AutomationImpact = {
  classification: "none" | "reduction" | "expansion" | "mixed"
  authorityExpansion: boolean
  authorityReduction: boolean
  budgetExpansion: boolean
  budgetReduction: boolean
  requiresApproval: boolean
  changedFields: string[]
}

export type AutomationControlRecord = {
  id: string
  draft: AutomationDraft
  state: "draft" | "active" | "paused" | "archived"
  enabled: boolean
  approval: {
    state: "pending" | "approved" | "denied" | "revoked"
    approvedBy: string | null
    approvedAt: number | null
    auditId: string | null
  }
  creator: { type: "user" | "agent"; chatId: string | null }
  version: number
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

export type AutomationControlErrorCode =
  "invalid-input" | "not-found" | "out-of-scope" | "conflict" | "approval-required" | "stale-caller"

export class AutomationControlError extends Error {
  constructor(
    public readonly code: AutomationControlErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "AutomationControlError"
  }
}

type Row = Record<string, unknown>
type CallerScope = {
  kind: string
  chatId: string
  projectId: string | null
  taskId: string | null
}

export type AutomationControlHooks = {
  /** Test seam for a version change after the read but before the update CAS. */
  beforeUpdateCas?: () => void
  /** Test seam for a version change after the read but before the archive CAS. */
  beforeArchiveCas?: () => void
}

export class AutomationControlService {
  constructor(
    private readonly databasePath: string,
    private readonly hooks: AutomationControlHooks = {},
  ) {}

  list(
    actor: AutomationControlActor,
    input: { includeArchived?: boolean; limit?: number; cursor?: string } = {},
  ): { items: AutomationControlRecord[]; nextCursor: string | null } {
    return this.withDatabase((database) => {
      const caller = callerScope(database, actor)
      const limit = Math.max(1, Math.min(input.limit ?? 20, PAGE_MAX))
      const start = decodeCursor(input.cursor)
      const ids = database
        .prepare(
          `SELECT id FROM automations
           WHERE (? = 1 OR archived_at IS NULL)
           ORDER BY updated_at DESC, id`,
        )
        .all(input.includeArchived ? 1 : 0) as Array<{ id: string }>
      const visible = ids
        .map(({ id }) => readRecord(database, id))
        .filter((record): record is AutomationControlRecord => Boolean(record))
        .filter((record) => isVisible(database, caller, record.draft.scope))
      const items = visible.slice(start, start + limit)
      return {
        items,
        nextCursor:
          start + limit < visible.length
            ? Buffer.from(String(start + limit)).toString("base64url")
            : null,
      }
    })
  }

  read(actor: AutomationControlActor, automationId: string): AutomationControlRecord {
    return this.withDatabase((database) => {
      const caller = callerScope(database, actor)
      const record = requireRecord(database, automationId)
      requireVisible(database, caller, record.draft.scope)
      return record
    })
  }

  createDraft(
    actor: AutomationControlActor,
    input: { draft: AutomationDraft; idempotencyKey?: string },
  ): { record: AutomationControlRecord; created: boolean } {
    const draft = parseDraft(input.draft)
    if (actor.type === "agent" && !input.idempotencyKey) {
      fail("invalid-input", "Agent-created drafts require an idempotency key.")
    }
    return this.withDatabase((database) => {
      const caller = callerScope(database, actor)
      validateDraftTarget(database, caller, draft.scope)
      const automationId =
        input.idempotencyKey === undefined
          ? randomUUID()
          : stableAutomationId(actor, normalizeIdempotencyKey(input.idempotencyKey))
      const existing = readRecord(database, automationId)
      if (existing) {
        requireVisible(database, caller, existing.draft.scope)
        if (canonicalJson(existing.draft) !== canonicalJson(draft)) {
          fail("conflict", "Idempotency key is already bound to a different automation draft.")
        }
        return { record: existing, created: false }
      }

      const now = Date.now()
      const transaction = database.transaction(() => {
        insertAutomation(database, automationId, actor, draft, now)
        writeAutomationChildren(database, automationId, draft, now)
      })
      transaction.immediate()
      return { record: requireRecord(database, automationId), created: true }
    })
  }

  classifyImpact(
    actor: AutomationControlActor,
    automationId: string,
    proposedDraft: AutomationDraft,
  ): AutomationImpact {
    const next = parseDraft(proposedDraft)
    return this.withDatabase((database) => {
      const caller = callerScope(database, actor)
      const current = requireRecord(database, automationId)
      requireVisible(database, caller, current.draft.scope)
      validateDraftTarget(database, caller, next.scope)
      return classifyAutomationImpact(current.draft, next)
    })
  }

  update(
    actor: AutomationControlActor,
    input: {
      automationId: string
      expectedVersion: number
      draft: AutomationDraft
      approval?: AutomationApprovalContext
    },
  ): { record: AutomationControlRecord; changed: boolean; impact: AutomationImpact } {
    const next = parseDraft(input.draft)
    return this.withDatabase((database) => {
      const caller = callerScope(database, actor)
      const current = requireRecord(database, input.automationId)
      requireVisible(database, caller, current.draft.scope)
      validateDraftTarget(database, caller, next.scope)
      const impact = classifyAutomationImpact(current.draft, next)
      if (canonicalJson(current.draft) === canonicalJson(next)) {
        if (
          current.version !== input.expectedVersion &&
          current.version !== input.expectedVersion + 1
        ) {
          conflict(current.version)
        }
        return { record: current, changed: false, impact }
      }
      if (current.version !== input.expectedVersion) conflict(current.version)
      if (current.state === "archived") fail("conflict", "Archived automations cannot be updated.")

      const expansion = impact.requiresApproval
      const approvedExpansion = expansion && input.approval
      const now = Date.now()
      this.hooks.beforeUpdateCas?.()
      const transaction = database.transaction(() => {
        const result = database
          .prepare(
            `UPDATE automations SET
              name = ?, description = ?, scope_type = ?, project_id = ?, task_id = ?, chat_id = ?,
              action_type = ?, action_config = ?, prompt = ?, harness = ?, model = ?,
              permission_mode = ?, custom_permissions = ?, worktree_strategy = ?, worktree_path = ?,
              state = ?, enabled = ?, approval_state = ?, approved_by = ?, approved_at = ?,
              approval_audit_id = ?, version = version + 1, updated_at = ?
             WHERE id = ? AND version = ?`,
          )
          .run(
            next.name,
            next.description ?? null,
            next.scope.type,
            next.scope.type === "project" ? next.scope.projectId : null,
            next.scope.type === "task" ? next.scope.taskId : null,
            next.scope.type === "chat" ? next.scope.chatId : null,
            next.action.type,
            JSON.stringify(next.action),
            next.run.prompt,
            next.run.harness,
            next.run.model ?? null,
            next.run.permissionMode,
            next.run.customPermissions ? JSON.stringify(next.run.customPermissions) : null,
            next.run.worktreeStrategy,
            next.run.worktreePath ?? null,
            expansion && !approvedExpansion ? "draft" : current.state,
            expansion && !approvedExpansion ? 0 : current.enabled ? 1 : 0,
            expansion ? (approvedExpansion ? "approved" : "pending") : current.approval.state,
            expansion
              ? approvedExpansion
                ? input.approval!.approvedBy
                : null
              : current.approval.approvedBy,
            expansion ? (approvedExpansion ? now : null) : current.approval.approvedAt,
            expansion
              ? approvedExpansion
                ? input.approval!.auditId
                : null
              : current.approval.auditId,
            now,
            input.automationId,
            input.expectedVersion,
          )
        if (result.changes !== 1) conflict(latestVersion(database, input.automationId))
        writeAutomationChildren(database, input.automationId, next, now)
      })
      transaction.immediate()
      return { record: requireRecord(database, input.automationId), changed: true, impact }
    })
  }

  reviewDraft(
    actor: AutomationControlActor,
    input: {
      automationId: string
      expectedVersion: number
      decision: "approve" | "deny"
      enable?: boolean
      approval: AutomationApprovalContext
    },
  ): { record: AutomationControlRecord; changed: boolean } {
    return this.withDatabase((database) => {
      const caller = callerScope(database, actor)
      const current = requireRecord(database, input.automationId)
      requireVisible(database, caller, current.draft.scope)
      if (current.state === "archived") fail("conflict", "Archived automations cannot be reviewed.")
      const enabled = input.decision === "approve" && Boolean(input.enable)
      const desiredState = enabled ? "active" : input.decision === "approve" ? "paused" : "draft"
      const desiredApproval = input.decision === "approve" ? "approved" : "denied"
      if (
        current.version === input.expectedVersion + 1 &&
        current.enabled === enabled &&
        current.state === desiredState &&
        current.approval.state === desiredApproval
      ) {
        return { record: current, changed: false }
      }
      if (current.version !== input.expectedVersion) conflict(current.version)
      const now = Date.now()
      const result = database
        .prepare(
          `UPDATE automations SET state = ?, enabled = ?, approval_state = ?, approved_by = ?,
             approved_at = ?, approval_audit_id = ?, version = version + 1, updated_at = ?
           WHERE id = ? AND version = ?`,
        )
        .run(
          desiredState,
          enabled ? 1 : 0,
          desiredApproval,
          input.approval.approvedBy,
          now,
          input.approval.auditId,
          now,
          input.automationId,
          input.expectedVersion,
        )
      if (result.changes !== 1) conflict(requireRecord(database, input.automationId).version)
      return { record: requireRecord(database, input.automationId), changed: true }
    })
  }

  setEnabled(
    actor: AutomationControlActor,
    input: {
      automationId: string
      expectedVersion: number
      enabled: boolean
      approval?: AutomationApprovalContext
    },
  ): { record: AutomationControlRecord; changed: boolean } {
    return this.withDatabase((database) => {
      const caller = callerScope(database, actor)
      const current = requireRecord(database, input.automationId)
      requireVisible(database, caller, current.draft.scope)
      if (current.state === "archived") fail("conflict", "Archived automations cannot be enabled.")
      if (current.enabled === input.enabled) {
        if (
          current.version !== input.expectedVersion &&
          current.version !== input.expectedVersion + 1
        ) {
          conflict(current.version)
        }
        return { record: current, changed: false }
      }
      if (current.version !== input.expectedVersion) conflict(current.version)
      if (input.enabled && !input.approval) {
        fail("approval-required", "Enabling an automation requires exact user approval.")
      }
      const now = Date.now()
      const result = database
        .prepare(
          `UPDATE automations SET state = ?, enabled = ?, approval_state = ?, approved_by = ?,
             approved_at = ?, approval_audit_id = ?, version = version + 1, updated_at = ?
           WHERE id = ? AND version = ?`,
        )
        .run(
          input.enabled ? "active" : "paused",
          input.enabled ? 1 : 0,
          input.enabled ? "approved" : current.approval.state,
          input.enabled ? input.approval!.approvedBy : current.approval.approvedBy,
          input.enabled ? now : current.approval.approvedAt,
          input.enabled ? input.approval!.auditId : current.approval.auditId,
          now,
          input.automationId,
          input.expectedVersion,
        )
      if (result.changes !== 1) conflict(requireRecord(database, input.automationId).version)
      return { record: requireRecord(database, input.automationId), changed: true }
    })
  }

  archive(
    actor: AutomationControlActor,
    input: { automationId: string; expectedVersion: number; auditId: string },
  ): { record: AutomationControlRecord; changed: boolean } {
    return this.withDatabase((database) => {
      const caller = callerScope(database, actor)
      const current = requireRecord(database, input.automationId)
      requireVisible(database, caller, current.draft.scope)
      if (current.state === "archived") {
        if (
          current.version !== input.expectedVersion &&
          current.version !== input.expectedVersion + 1
        ) {
          conflict(current.version)
        }
        return { record: current, changed: false }
      }
      if (current.version !== input.expectedVersion) conflict(current.version)
      const now = Date.now()
      this.hooks.beforeArchiveCas?.()
      const result = database
        .prepare(
          `UPDATE automations SET state = 'archived', enabled = 0, approval_state = 'revoked',
             approved_by = ?, approved_at = ?, approval_audit_id = ?, archived_at = ?,
             version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
        )
        .run(
          actorLabel(actor),
          now,
          input.auditId,
          now,
          now,
          input.automationId,
          input.expectedVersion,
        )
      if (result.changes !== 1) conflict(latestVersion(database, input.automationId))
      return { record: requireRecord(database, input.automationId), changed: true }
    })
  }

  private withDatabase<T>(operation: (database: Database.Database) => T): T {
    const database = openAppDatabase(this.databasePath)
    try {
      database.pragma("foreign_keys = ON")
      database.pragma("busy_timeout = 5000")
      return operation(database)
    } catch (error) {
      if (error instanceof AutomationControlError) throw error
      const message = error instanceof Error ? error.message : "Automation control failed."
      if (/FOREIGN KEY|CHECK constraint/i.test(message)) fail("invalid-input", message)
      throw error
    } finally {
      database.close()
    }
  }
}

export function classifyAutomationImpact(
  current: AutomationDraft,
  next: AutomationDraft,
): AutomationImpact {
  const changedFields: string[] = []
  let authorityExpansion = false
  let authorityReduction = false
  let budgetExpansion = false
  let budgetReduction = false
  const authority = (field: string, relation: -1 | 0 | 1 | 2) => {
    if (relation === 0) return
    changedFields.push(field)
    if (relation === 1 || relation === 2) authorityExpansion = true
    if (relation === -1 || relation === 2) authorityReduction = true
  }
  const budget = (field: string, relation: -1 | 0 | 1 | 2) => {
    if (relation === 0) return
    changedFields.push(field)
    if (relation === 1 || relation === 2) budgetExpansion = true
    if (relation === -1 || relation === 2) budgetReduction = true
  }

  authority("scope", compareScope(current.scope, next.scope))
  authority("action", compareRank(actionRank(current.action.type), actionRank(next.action.type)))
  authority("trigger", compareTrigger(current.trigger, next.trigger))
  authority("run.permissionMode", comparePermission(current, next))
  authority(
    "run.worktree",
    current.run.worktreeStrategy === next.run.worktreeStrategy &&
      current.run.worktreePath === next.run.worktreePath
      ? 0
      : 2,
  )
  authority("run.harness", current.run.harness === next.run.harness ? 0 : 2)
  if (current.run.model !== next.run.model) authority("run.model", 2)

  budget(
    "budget.maxDurationMs",
    compareLimit(current.budget.maxDurationMs, next.budget.maxDurationMs),
  )
  budget(
    "budget.maxTotalTokens",
    compareLimit(current.budget.maxTotalTokens, next.budget.maxTotalTokens),
  )
  budget(
    "budget.maxCostUsdMicros",
    compareLimit(current.budget.maxCostUsdMicros, next.budget.maxCostUsdMicros),
  )
  budget("retry.maxAttempts", compareRank(current.retry.maxAttempts, next.retry.maxAttempts))
  budget("retry.deadlineMs", compareRank(current.retry.deadlineMs, next.retry.deadlineMs))

  const expansion = authorityExpansion || budgetExpansion
  const reduction = authorityReduction || budgetReduction
  return {
    classification: expansion
      ? reduction
        ? "mixed"
        : "expansion"
      : reduction
        ? "reduction"
        : "none",
    authorityExpansion,
    authorityReduction,
    budgetExpansion,
    budgetReduction,
    requiresApproval: expansion,
    changedFields: [...new Set(changedFields)].sort(),
  }
}

function parseDraft(value: AutomationDraft): AutomationDraft {
  const parsed = automationDraftSchema.safeParse(value)
  if (!parsed.success) fail("invalid-input", parsed.error.issues[0]?.message ?? "Invalid draft.")
  return parsed.data
}

function insertAutomation(
  database: Database.Database,
  automationId: string,
  actor: AutomationControlActor,
  draft: AutomationDraft,
  now: number,
): void {
  database
    .prepare(
      `INSERT INTO automations (
        id, name, description, scope_type, project_id, task_id, chat_id, action_type,
        action_config, prompt, harness, model, permission_mode, custom_permissions,
        worktree_strategy, worktree_path, state, enabled, approval_state, created_by_type,
        created_by_chat_id, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 0, 'pending', ?, ?, 1, ?, ?)`,
    )
    .run(
      automationId,
      draft.name,
      draft.description ?? null,
      draft.scope.type,
      draft.scope.type === "project" ? draft.scope.projectId : null,
      draft.scope.type === "task" ? draft.scope.taskId : null,
      draft.scope.type === "chat" ? draft.scope.chatId : null,
      draft.action.type,
      JSON.stringify(draft.action),
      draft.run.prompt,
      draft.run.harness,
      draft.run.model ?? null,
      draft.run.permissionMode,
      draft.run.customPermissions ? JSON.stringify(draft.run.customPermissions) : null,
      draft.run.worktreeStrategy,
      draft.run.worktreePath ?? null,
      actor.type,
      actor.type === "agent" ? actor.chatId : null,
      now,
      now,
    )
}

function writeAutomationChildren(
  database: Database.Database,
  automationId: string,
  draft: AutomationDraft,
  now: number,
): void {
  const trigger = triggerColumns(draft.trigger)
  const existing = database
    .prepare(
      "SELECT id FROM automation_triggers WHERE automation_id = ? ORDER BY created_at, id LIMIT 1",
    )
    .get(automationId) as { id: string } | undefined
  if (existing) {
    database
      .prepare(
        `UPDATE automation_triggers SET type = ?, enabled = 1, cron = ?, timezone = ?, catch_up = ?,
           run_project_id = ?, run_task_id = ?, run_chat_id = ?, run_statuses = ?, root_path = ?,
           include_globs = ?, exclude_globs = ?, debounce_ms = ?, next_fire_at = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(...trigger, now, existing.id)
  } else {
    database
      .prepare(
        `INSERT INTO automation_triggers (
          id, automation_id, type, enabled, cron, timezone, catch_up, run_project_id,
          run_task_id, run_chat_id, run_statuses, root_path, include_globs, exclude_globs,
          debounce_ms, created_at, updated_at
        ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), automationId, ...trigger, now, now)
  }
  database
    .prepare(
      `INSERT INTO automation_retry_policies
        (automation_id, mode, max_attempts, initial_delay_ms, max_delay_ms, deadline_ms)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(automation_id) DO UPDATE SET mode = excluded.mode,
         max_attempts = excluded.max_attempts, initial_delay_ms = excluded.initial_delay_ms,
         max_delay_ms = excluded.max_delay_ms, deadline_ms = excluded.deadline_ms`,
    )
    .run(
      automationId,
      draft.retry.mode,
      draft.retry.maxAttempts,
      draft.retry.initialDelayMs,
      draft.retry.maxDelayMs,
      draft.retry.deadlineMs,
    )
  database
    .prepare(
      `INSERT INTO automation_budgets
        (automation_id, max_duration_ms, max_total_tokens, max_cost_usd_micros, max_concurrent_runs)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(automation_id) DO UPDATE SET max_duration_ms = excluded.max_duration_ms,
         max_total_tokens = excluded.max_total_tokens,
         max_cost_usd_micros = excluded.max_cost_usd_micros,
         max_concurrent_runs = excluded.max_concurrent_runs`,
    )
    .run(
      automationId,
      draft.budget.maxDurationMs,
      draft.budget.maxTotalTokens,
      draft.budget.maxCostUsdMicros,
      draft.budget.maxConcurrentRuns,
    )
}

function triggerColumns(trigger: AutomationTrigger): unknown[] {
  return [
    trigger.type,
    trigger.type === "schedule" ? trigger.cron : null,
    trigger.type === "schedule" ? trigger.timezone : null,
    trigger.type === "schedule" ? trigger.catchUp : null,
    trigger.type === "run-complete" ? (trigger.projectId ?? null) : null,
    trigger.type === "run-complete" ? (trigger.taskId ?? null) : null,
    trigger.type === "run-complete" ? (trigger.chatId ?? null) : null,
    trigger.type === "run-complete" ? JSON.stringify(trigger.statuses) : null,
    trigger.type === "file-change" ? trigger.rootPath : null,
    trigger.type === "file-change" ? JSON.stringify(trigger.includeGlobs) : null,
    trigger.type === "file-change" ? JSON.stringify(trigger.excludeGlobs) : null,
    trigger.type === "file-change" ? trigger.debounceMs : null,
  ]
}

function readRecord(
  database: Database.Database,
  automationId: string,
): AutomationControlRecord | null {
  const row = database
    .prepare(
      `SELECT a.*, tr.id trigger_id, tr.type trigger_type, tr.cron, tr.timezone, tr.catch_up,
         tr.run_project_id, tr.run_task_id, tr.run_chat_id, tr.run_statuses, tr.root_path,
         tr.include_globs, tr.exclude_globs, tr.debounce_ms,
         rp.mode retry_mode, rp.max_attempts, rp.initial_delay_ms, rp.max_delay_ms, rp.deadline_ms,
         b.max_duration_ms, b.max_total_tokens, b.max_cost_usd_micros, b.max_concurrent_runs
       FROM automations a
       JOIN automation_triggers tr ON tr.automation_id = a.id
       JOIN automation_retry_policies rp ON rp.automation_id = a.id
       JOIN automation_budgets b ON b.automation_id = a.id
       WHERE a.id = ? ORDER BY tr.created_at, tr.id LIMIT 1`,
    )
    .get(automationId) as Row | undefined
  if (!row) return null
  const draft = automationDraftSchema.parse({
    name: row.name,
    description: row.description,
    scope: rowScope(row),
    action: parseStoredJson(row.action_config, "automation action"),
    trigger: rowTrigger(row),
    run: {
      prompt: row.prompt,
      harness: row.harness,
      ...(row.model ? { model: row.model } : {}),
      permissionMode: row.permission_mode,
      ...(row.custom_permissions
        ? { customPermissions: parseStoredJson(row.custom_permissions, "custom permissions") }
        : {}),
      worktreeStrategy: row.worktree_strategy,
      ...(row.worktree_path ? { worktreePath: row.worktree_path } : {}),
    },
    retry: {
      mode: row.retry_mode,
      maxAttempts: row.max_attempts,
      initialDelayMs: row.initial_delay_ms,
      maxDelayMs: row.max_delay_ms,
      deadlineMs: row.deadline_ms,
    },
    budget: {
      maxDurationMs: row.max_duration_ms ?? null,
      maxTotalTokens: row.max_total_tokens ?? null,
      maxCostUsdMicros: row.max_cost_usd_micros ?? null,
      maxConcurrentRuns: row.max_concurrent_runs,
    },
  })
  return {
    id: String(row.id),
    draft,
    state: row.state as AutomationControlRecord["state"],
    enabled: Boolean(row.enabled),
    approval: {
      state: row.approval_state as AutomationControlRecord["approval"]["state"],
      approvedBy: stringOrNull(row.approved_by),
      approvedAt: numberOrNull(row.approved_at),
      auditId: stringOrNull(row.approval_audit_id),
    },
    creator: {
      type: row.created_by_type as "user" | "agent",
      chatId: stringOrNull(row.created_by_chat_id),
    },
    version: Number(row.version),
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
    archivedAt: numberOrNull(row.archived_at),
  }
}

function rowScope(row: Row): AutomationScope {
  switch (row.scope_type) {
    case "global":
      return { type: "global" }
    case "project":
      return { type: "project", projectId: String(row.project_id) }
    case "task":
      return { type: "task", taskId: String(row.task_id) }
    case "chat":
      return { type: "chat", chatId: String(row.chat_id) }
    default:
      fail("invalid-input", "Stored automation scope is invalid.")
  }
}

function rowTrigger(row: Row): AutomationTrigger {
  switch (row.trigger_type) {
    case "manual":
      return { type: "manual" }
    case "schedule":
      return {
        type: "schedule",
        cron: String(row.cron),
        timezone: String(row.timezone),
        catchUp: row.catch_up as "none" | "one",
      }
    case "run-complete":
      return {
        type: "run-complete",
        ...(row.run_project_id ? { projectId: String(row.run_project_id) } : {}),
        ...(row.run_task_id ? { taskId: String(row.run_task_id) } : {}),
        ...(row.run_chat_id ? { chatId: String(row.run_chat_id) } : {}),
        statuses: parseStoredJson(row.run_statuses, "run statuses") as Array<
          "success" | "failure" | "cancelled"
        >,
      }
    case "file-change":
      return {
        type: "file-change",
        rootPath: String(row.root_path),
        includeGlobs: parseStoredJson(row.include_globs, "include globs") as string[],
        excludeGlobs: parseStoredJson(row.exclude_globs, "exclude globs") as string[],
        debounceMs: Number(row.debounce_ms),
      }
    default:
      fail("invalid-input", "Stored automation trigger is invalid.")
  }
}

function callerScope(
  database: Database.Database,
  actor: AutomationControlActor,
): CallerScope | null {
  if (actor.type === "user") return null
  const row = database
    .prepare(
      "SELECT id, scope, project_id, task_id FROM chats WHERE id = ? AND archived_at IS NULL",
    )
    .get(actor.chatId) as Row | undefined
  if (!row) fail("stale-caller", "Caller chat is missing or archived.")
  return {
    kind: String(row.scope),
    chatId: String(row.id),
    projectId: stringOrNull(row.project_id),
    taskId: stringOrNull(row.task_id),
  }
}

function validateDraftTarget(
  database: Database.Database,
  caller: CallerScope | null,
  scope: AutomationScope,
): void {
  targetScope(database, scope)
  requireVisible(database, caller, scope)
}

function targetScope(
  database: Database.Database,
  scope: AutomationScope,
): { projectId: string | null; taskId: string | null; chatId: string | null } {
  if (scope.type === "global") return { projectId: null, taskId: null, chatId: null }
  if (scope.type === "project") {
    const row = database
      .prepare("SELECT id FROM projects WHERE id = ? AND archived_at IS NULL")
      .get(scope.projectId)
    if (!row) fail("not-found", "Automation project is missing or archived.")
    return { projectId: scope.projectId, taskId: null, chatId: null }
  }
  if (scope.type === "task") {
    const row = database
      .prepare("SELECT project_id FROM tasks WHERE id = ? AND archived_at IS NULL")
      .get(scope.taskId) as Row | undefined
    if (!row) fail("not-found", "Automation task is missing or archived.")
    return { projectId: String(row.project_id), taskId: scope.taskId, chatId: null }
  }
  const row = database
    .prepare("SELECT project_id, task_id FROM chats WHERE id = ? AND archived_at IS NULL")
    .get(scope.chatId) as Row | undefined
  if (!row) fail("not-found", "Automation chat is missing or archived.")
  return {
    projectId: stringOrNull(row.project_id),
    taskId: stringOrNull(row.task_id),
    chatId: scope.chatId,
  }
}

function isVisible(
  database: Database.Database,
  caller: CallerScope | null,
  scope: AutomationScope,
): boolean {
  if (!caller) return true
  const target = targetScope(database, scope)
  if (caller.kind === "global") return true
  if (caller.kind === "project") return target.projectId === caller.projectId
  if (caller.kind === "task") return target.taskId === caller.taskId
  return target.chatId === caller.chatId
}

function requireVisible(
  database: Database.Database,
  caller: CallerScope | null,
  scope: AutomationScope,
): void {
  if (!isVisible(database, caller, scope)) {
    fail("out-of-scope", "Automation is outside the caller scope.")
  }
}

function requireRecord(database: Database.Database, automationId: string): AutomationControlRecord {
  const record = readRecord(database, automationId)
  if (!record) fail("not-found", "Automation is missing or stale.")
  return record
}

function compareScope(current: AutomationScope, next: AutomationScope): -1 | 0 | 1 | 2 {
  if (canonicalJson(current) === canonicalJson(next)) return 0
  const rank = { chat: 0, task: 1, project: 2, global: 3 } as const
  const relation = compareRank(rank[current.type], rank[next.type])
  return relation === 0 ? 2 : relation
}

function compareTrigger(current: AutomationTrigger, next: AutomationTrigger): -1 | 0 | 1 | 2 {
  if (canonicalJson(current) === canonicalJson(next)) return 0
  const rank = { manual: 0, "run-complete": 1, schedule: 2, "file-change": 2 } as const
  const relation = compareRank(rank[current.type], rank[next.type])
  return relation === 0 ? 2 : relation
}

function comparePermission(current: AutomationDraft, next: AutomationDraft): -1 | 0 | 1 | 2 {
  const left = current.run
  const right = next.run
  if (
    left.permissionMode === right.permissionMode &&
    canonicalJson(left.customPermissions ?? null) === canonicalJson(right.customPermissions ?? null)
  ) {
    return 0
  }
  if (left.permissionMode === "custom" && right.permissionMode === "custom") {
    let raised = false
    let lowered = false
    for (const key of customPermissionCapabilityKeys) {
      if (!left.customPermissions![key] && right.customPermissions![key]) raised = true
      if (left.customPermissions![key] && !right.customPermissions![key]) lowered = true
    }
    return raised ? (lowered ? 2 : 1) : -1
  }
  const rank = {
    "read-only": 0,
    "ask-before-edits": 1,
    "auto-edit-project-only": 2,
    custom: 3,
    "full-access": 4,
  } as const
  return compareRank(rank[left.permissionMode], rank[right.permissionMode])
}

function compareRank(current: number, next: number): -1 | 0 | 1 {
  return next === current ? 0 : next > current ? 1 : -1
}

function compareLimit(current: number | null, next: number | null): -1 | 0 | 1 {
  const left = current ?? Number.POSITIVE_INFINITY
  const right = next ?? Number.POSITIVE_INFINITY
  return compareRank(left, right)
}

function actionRank(action: AutomationDraft["action"]["type"]): number {
  return action === "run-chat" ? 0 : action === "create-chat-run" ? 1 : 2
}

function stableAutomationId(actor: AutomationControlActor, idempotencyKey: string): string {
  return `auto_${createHash("sha256")
    .update(canonicalJson({ actor, idempotencyKey }))
    .digest("hex")
    .slice(0, 32)}`
}

function normalizeIdempotencyKey(value: string): string {
  const key = value.trim()
  if (!key || key.length > 128) fail("invalid-input", "Idempotency key must be 1-128 characters.")
  return key
}

function actorLabel(actor: AutomationControlActor): string {
  return actor.type === "user" ? actor.id : `agent:${actor.chatId}`
}

function decodeCursor(cursor?: string): number {
  if (!cursor) return 0
  const value = Number.parseInt(Buffer.from(cursor, "base64url").toString("utf8"), 10)
  if (!Number.isSafeInteger(value) || value < 0) fail("invalid-input", "Invalid cursor.")
  return value
}

function parseStoredJson(value: unknown, label: string): unknown {
  return parseJsonText(
    value,
    () => new AutomationControlError("invalid-input", `Stored ${label} is invalid.`),
  )
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null
}

function conflict(currentVersion: number): never {
  fail("conflict", `Automation version is stale; current version is ${currentVersion}.`)
}

function latestVersion(database: Database.Database, automationId: string): number {
  const row = database.prepare("SELECT version FROM automations WHERE id = ?").get(automationId) as
    { version: number } | undefined
  return row?.version ?? 0
}

function fail(code: AutomationControlErrorCode, message: string): never {
  throw new AutomationControlError(code, message)
}

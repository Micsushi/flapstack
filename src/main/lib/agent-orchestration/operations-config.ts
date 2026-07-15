import Database from "better-sqlite3"
import { createId } from "../db/utils"
import {
  approvalContextHash,
  POLICY_APPROVAL_TOOL,
  TEMPLATE_LAUNCH_APPROVAL_TOOL,
  type OrchestrationAuthorityTool,
} from "./approval-authority"
import {
  orchestrationPolicyUpdateSchema,
  orchestrationTemplateArchiveSchema,
  orchestrationTemplateCreateSchema,
  orchestrationTemplateDefinitionSchema,
  orchestrationTemplateUpdateSchema,
  type OrchestrationMessage,
  type OrchestrationPolicy,
  type OrchestrationTemplateDefinition,
  type PolicyChangeKind,
} from "../../../shared/orchestration-operations"

type Row = Record<string, unknown>

export class OrchestrationOperationsError extends Error {
  constructor(
    readonly code:
      | "not-found"
      | "version-conflict"
      | "approval-required"
      | "invalid-approval"
      | "invalid-template",
    message: string,
  ) {
    super(message)
    this.name = "OrchestrationOperationsError"
  }
}

export function classifyPolicyChange(
  current: OrchestrationPolicy,
  next: OrchestrationPolicy,
): PolicyChangeKind {
  let tighter = false
  let looser = false
  for (const key of ["maxParallelAgents", "maxDepth", "maxTotalAgents"] as const) {
    tighter ||= next[key] < current[key]
    looser ||= next[key] > current[key]
  }
  for (const key of ["maxTotalTokens", "maxCostUsdMicros"] as const) {
    const before = current[key] ?? Number.POSITIVE_INFINITY
    const after = next[key] ?? Number.POSITIVE_INFINITY
    tighter ||= after < before
    looser ||= after > before
  }
  tighter ||= current.allowSpawn && !next.allowSpawn
  looser ||= !current.allowSpawn && next.allowSpawn
  if (tighter && looser) return "mixed"
  if (looser) return "relax"
  if (tighter) return "tighten"
  return "unchanged"
}

export function createOrchestrationOperationsService(databasePath: string) {
  const open = () => new Database(databasePath)
  return {
    getApprovalContext(taskId: string) {
      const db = open()
      try {
        return approvalCaller(db, taskId)
      } finally {
        db.close()
      }
    },

    getPolicy(taskId: string) {
      const db = open()
      try {
        return readPolicy(db, taskId)
      } finally {
        db.close()
      }
    },

    previewPolicy(inputValue: unknown) {
      const input = orchestrationPolicyUpdateSchema.parse(inputValue)
      const current = this.getPolicy(input.taskId)
      if (current.version !== input.expectedVersion)
        throw new OrchestrationOperationsError("version-conflict", "Policy version is stale.")
      const changeKind = classifyPolicyChange(current.policy, input.policy)
      return {
        taskId: input.taskId,
        currentVersion: current.version,
        current: current.policy,
        proposed: input.policy,
        changeKind,
        approvalRequired: changeKind === "relax" || changeKind === "mixed",
      }
    },

    updatePolicy(inputValue: unknown, verifiedApprovalAuditId: string | null = null) {
      const input = orchestrationPolicyUpdateSchema.parse(inputValue)
      const current = this.getPolicy(input.taskId)
      if (current.version !== input.expectedVersion)
        throw new OrchestrationOperationsError("version-conflict", "Policy version is stale.")
      const changeKind = classifyPolicyChange(current.policy, input.policy)
      const approvalRequired = changeKind === "relax" || changeKind === "mixed"
      if (approvalRequired && !verifiedApprovalAuditId) {
        throw new OrchestrationOperationsError(
          "approval-required",
          "Increasing orchestration authority or budget requires a fresh Stage 3 approval.",
        )
      }
      const db = open()
      try {
        const tx = db.transaction(() => {
          const caller = approvalCaller(db, input.taskId)
          if (approvalRequired) {
            verifyApprovalAudit(db, {
              auditId: verifiedApprovalAuditId!,
              toolName: POLICY_APPROVAL_TOOL,
              callerChatId: caller.chatId,
              callerRunId: caller.runId,
              authority: policyApprovalAuthority(input, changeKind),
            })
            consumeApprovalAudit(db, verifiedApprovalAuditId!, input.taskId, POLICY_APPROVAL_TOOL)
          }
          const latest = db
            .prepare(
              "SELECT coalesce(max(version), 0) version FROM orchestration_policy_versions WHERE task_id = ?",
            )
            .get(input.taskId) as { version: number }
          const persistedVersion = latest.version === 0 ? 1 : latest.version
          if (persistedVersion !== input.expectedVersion)
            throw new OrchestrationOperationsError("version-conflict", "Policy version is stale.")
          const version = input.expectedVersion + 1
          db.prepare(
            "INSERT INTO orchestration_policy_versions (task_id, version, policy_json, change_kind, approval_audit_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          ).run(
            input.taskId,
            version,
            JSON.stringify(input.policy),
            changeKind,
            approvalRequired ? verifiedApprovalAuditId : null,
            epoch(),
          )
          const currentStop = db
            .prepare("SELECT stop_conditions FROM task_orchestrations WHERE task_id = ?")
            .get(input.taskId) as { stop_conditions: string } | undefined
          if (!currentStop)
            throw new OrchestrationOperationsError("not-found", "Orchestration does not exist.")
          const stopConditions = parseObject(currentStop.stop_conditions)
          setNullableNumber(stopConditions, "maxTotalTokens", input.policy.maxTotalTokens)
          setNullableNumber(stopConditions, "maxCostUsdMicros", input.policy.maxCostUsdMicros)
          db.prepare(
            "UPDATE task_orchestrations SET max_parallel_agents = ?, max_depth = ?, stop_conditions = ?, policy_version = ?, updated_at = ? WHERE task_id = ?",
          ).run(
            input.policy.maxParallelAgents,
            input.policy.maxDepth,
            JSON.stringify(stopConditions),
            version,
            epoch(),
            input.taskId,
          )
          return version
        })
        const version = tx.immediate()
        return {
          taskId: input.taskId,
          version,
          policy: input.policy,
          changeKind,
          approvalAuditId: approvalRequired ? verifiedApprovalAuditId : null,
          createdAt: epoch(),
        }
      } finally {
        db.close()
      }
    },

    listTemplates() {
      const db = open()
      try {
        return (
          db
            .prepare(
              "SELECT * FROM orchestration_templates WHERE archived_at IS NULL ORDER BY lower(name), id",
            )
            .all() as Row[]
        ).map(templateRow)
      } finally {
        db.close()
      }
    },

    createTemplate(inputValue: unknown) {
      const input = orchestrationTemplateCreateSchema.parse(inputValue)
      assertSafeTemplate(input.definition)
      const db = open()
      try {
        const id = createId()
        const now = epoch()
        db.prepare(
          "INSERT INTO orchestration_templates (id, name, version, definition_json, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)",
        ).run(id, input.name, JSON.stringify(input.definition), now, now)
        return {
          id,
          name: input.name,
          version: 1,
          definition: input.definition,
          createdAt: now,
          updatedAt: now,
        }
      } finally {
        db.close()
      }
    },

    updateTemplate(inputValue: unknown) {
      const input = orchestrationTemplateUpdateSchema.parse(inputValue)
      assertSafeTemplate(input.definition)
      const db = open()
      try {
        const result = db
          .prepare(
            "UPDATE orchestration_templates SET name = ?, definition_json = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND archived_at IS NULL",
          )
          .run(
            input.name,
            JSON.stringify(input.definition),
            epoch(),
            input.id,
            input.expectedVersion,
          )
        if (result.changes !== 1)
          throw new OrchestrationOperationsError(
            "version-conflict",
            "Template version is stale or missing.",
          )
        return templateRow(
          db.prepare("SELECT * FROM orchestration_templates WHERE id = ?").get(input.id) as Row,
        )
      } finally {
        db.close()
      }
    },

    archiveTemplate(inputValue: unknown) {
      const input = orchestrationTemplateArchiveSchema.parse(inputValue)
      const db = open()
      try {
        const now = epoch()
        const result = db
          .prepare(
            "UPDATE orchestration_templates SET archived_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND archived_at IS NULL",
          )
          .run(now, now, input.id, input.expectedVersion)
        if (result.changes !== 1)
          throw new OrchestrationOperationsError(
            "version-conflict",
            "Template version is stale or missing.",
          )
        return { id: input.id, archivedAt: now, version: input.expectedVersion + 1 }
      } finally {
        db.close()
      }
    },

    previewTemplate(definitionValue: unknown) {
      const definition = orchestrationTemplateDefinitionSchema.parse(definitionValue)
      assertSafeTemplate(definition)
      return {
        schemaVersion: 1 as const,
        engine: definition.engine,
        policy: definition.policy,
        workflow: definition.workflow.steps.map((step) => ({
          id: step.id,
          kind: step.kind,
          dependsOn: step.dependsOn,
          outputSchema: step.outputSchema,
        })),
        agents: definition.agents.map((agent) => ({
          role: agent.role,
          harness: agent.harness,
          model: agent.model ?? null,
          runtimePreference: agent.runtimePreference ?? "auto",
          permissionMode: agent.permissionMode,
          worktreeStrategy: agent.worktreeStrategy,
          dependencies: agent.dependencyAgentIds,
        })),
        requiresRuntimeProbe: true as const,
      }
    },

    getTemplate(id: string) {
      const db = open()
      try {
        const row = db
          .prepare("SELECT * FROM orchestration_templates WHERE id = ? AND archived_at IS NULL")
          .get(id) as Row | undefined
        if (!row) throw new OrchestrationOperationsError("not-found", "Template does not exist.")
        return templateRow(row)
      } finally {
        db.close()
      }
    },

    verifyTemplateLaunchApproval(taskId: string, definitionValue: unknown, auditId: string | null) {
      const definition = orchestrationTemplateDefinitionSchema.parse(definitionValue)
      assertSafeTemplate(definition)
      const current = this.getPolicy(taskId)
      const changeKind = classifyPolicyChange(current.policy, definition.policy)
      const approvalRequired =
        changeKind === "relax" ||
        changeKind === "mixed" ||
        definition.policy.maxTotalTokens !== null ||
        definition.policy.maxCostUsdMicros !== null
      if (!approvalRequired) return { approvalRequired: false, auditId: null }
      if (!auditId)
        throw new OrchestrationOperationsError(
          "approval-required",
          "Template authority or budget launch requires a fresh Stage 3 approval.",
        )
      const db = open()
      try {
        const caller = approvalCaller(db, taskId)
        verifyApprovalAudit(db, {
          auditId,
          toolName: TEMPLATE_LAUNCH_APPROVAL_TOOL,
          callerChatId: caller.chatId,
          callerRunId: caller.runId,
          authority: templateLaunchAuthority(taskId, definition, current.version),
        })
      } finally {
        db.close()
      }
      return { approvalRequired: true, auditId }
    },

    listMessages(taskId: string): OrchestrationMessage[] {
      const db = open()
      try {
        return (
          db
            .prepare(
              "SELECT * FROM orchestration_messages WHERE task_id = ? ORDER BY created_at, id",
            )
            .all(taskId) as Row[]
        ).map(messageRow)
      } finally {
        db.close()
      }
    },
  }
}

function assertSafeTemplate(definition: OrchestrationTemplateDefinition): void {
  orchestrationTemplateDefinitionSchema.parse(definition)
  const forbidden =
    /(^|_)(secret|token|credential|session|run_id|chat_id|provider_id|api_key)($|_)/i
  const secretValues: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\b(?:sk|rk|pk)-(?:proj-)?[A-Za-z0-9_-]{16,}\b/, label: "API credential" },
    { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/, label: "GitHub credential" },
    { pattern: /\bAKIA[A-Z0-9]{16}\b/, label: "AWS access key" },
    { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, label: "Slack credential" },
    { pattern: /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}=*\b/i, label: "bearer credential" },
    { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: "private key" },
    {
      pattern: /\b(?:api[-_ ]?key|token|secret|password|authorization)\s*[:=]\s*[^\s,;]{8,}/i,
      label: "embedded credential",
    },
    { pattern: /https?:\/\/[^\s/:]+:[^\s/@]+@/i, label: "URL credential" },
    {
      pattern: /(?:^|[\\/])(?:\.ssh|\.aws|\.gnupg|\.env(?:\.|$)|credentials)(?:[\\/]|$)/i,
      label: "secret-bearing path",
    },
    {
      pattern: /\b(?:session|chat|run|provider)[-_]?(?:id)?\s*[:=]\s*[A-Za-z0-9_-]{8,}/i,
      label: "live authority identity",
    },
  ]
  const visit = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      const matched = secretValues.find(({ pattern }) => pattern.test(value))
      if (matched)
        throw new OrchestrationOperationsError(
          "invalid-template",
          `Template contains ${matched.label} at ${path || "definition"}.`,
        )
      return
    }
    if (!value || typeof value !== "object") return
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, `${path}[${index}]`))
      return
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (forbidden.test(key))
        throw new OrchestrationOperationsError(
          "invalid-template",
          `Template contains forbidden live authority at ${path}${key}.`,
        )
      visit(child, path ? `${path}.${key}` : key)
    }
  }
  visit(definition, "")
}

export function policyApprovalAuthority(
  input: ReturnType<typeof orchestrationPolicyUpdateSchema.parse>,
  changeKind: PolicyChangeKind,
) {
  return {
    taskId: input.taskId,
    expectedVersion: input.expectedVersion,
    policy: input.policy,
    changeKind,
  }
}

export function templateLaunchAuthority(
  taskId: string,
  definition: OrchestrationTemplateDefinition,
  policyVersion: number,
) {
  return {
    taskId,
    policyVersion,
    definition: orchestrationTemplateDefinitionSchema.parse(definition),
  }
}

export function verifyAndConsumeTemplateLaunchApproval(
  db: Database.Database,
  taskId: string,
  definitionValue: unknown,
  auditId: string | null,
) {
  const definition = orchestrationTemplateDefinitionSchema.parse(definitionValue)
  assertSafeTemplate(definition)
  const current = readPolicy(db, taskId)
  const changeKind = classifyPolicyChange(current.policy, definition.policy)
  const approvalRequired =
    changeKind === "relax" ||
    changeKind === "mixed" ||
    definition.policy.maxTotalTokens !== null ||
    definition.policy.maxCostUsdMicros !== null
  if (!approvalRequired) {
    if (auditId)
      throw new OrchestrationOperationsError(
        "invalid-approval",
        "Template launch supplied an approval audit that is not required.",
      )
    return
  }
  if (!auditId)
    throw new OrchestrationOperationsError(
      "approval-required",
      "Template authority or budget launch requires a fresh Stage 3 approval.",
    )
  const caller = approvalCaller(db, taskId)
  verifyApprovalAudit(db, {
    auditId,
    toolName: TEMPLATE_LAUNCH_APPROVAL_TOOL,
    callerChatId: caller.chatId,
    callerRunId: caller.runId,
    authority: templateLaunchAuthority(taskId, definition, current.version),
  })
  consumeApprovalAudit(db, auditId, taskId, TEMPLATE_LAUNCH_APPROVAL_TOOL)
}

function readPolicy(db: Database.Database, taskId: string) {
  const row = db
    .prepare(
      "SELECT version, policy_json, change_kind, approval_audit_id, created_at FROM orchestration_policy_versions WHERE task_id = ? ORDER BY version DESC LIMIT 1",
    )
    .get(taskId) as Row | undefined
  if (row) return policyRow(taskId, row)
  const task = db
    .prepare(
      "SELECT max_parallel_agents, max_depth, stop_conditions FROM task_orchestrations WHERE task_id = ?",
    )
    .get(taskId) as Row | undefined
  if (!task) throw new OrchestrationOperationsError("not-found", "Orchestration does not exist.")
  const stop = parseObject(task.stop_conditions)
  return {
    taskId,
    version: 1,
    policy: {
      maxParallelAgents: Number(task.max_parallel_agents),
      maxDepth: Number(task.max_depth),
      maxTotalAgents: 256,
      maxTotalTokens: numberOrNull(stop.maxTotalTokens),
      maxCostUsdMicros: numberOrNull(stop.maxCostUsdMicros),
      allowSpawn: true,
    } satisfies OrchestrationPolicy,
    changeKind: "initial" as const,
    approvalAuditId: null,
    createdAt: 0,
  }
}

function approvalCaller(db: Database.Database, taskId: string) {
  const row = db
    .prepare(
      `SELECT o.initiating_chat_id chat_id, r.id run_id
       FROM task_orchestrations o
       LEFT JOIN agent_runs r ON r.chat_id = o.initiating_chat_id
       WHERE o.task_id = ?
       ORDER BY r.started_at DESC, r.id DESC LIMIT 1`,
    )
    .get(taskId) as { chat_id: string; run_id: string | null } | undefined
  if (!row) throw new OrchestrationOperationsError("not-found", "Orchestration does not exist.")
  return { chatId: row.chat_id, runId: row.run_id }
}

function verifyApprovalAudit(
  db: Database.Database,
  input: {
    auditId: string
    toolName: OrchestrationAuthorityTool
    callerChatId: string
    callerRunId: string | null
    authority: unknown
  },
) {
  const consumed = db
    .prepare(
      `SELECT audit_id approval_audit_id FROM orchestration_authority_approvals WHERE audit_id = ?
       UNION ALL
       SELECT approval_audit_id FROM orchestration_policy_versions WHERE approval_audit_id = ?
       UNION ALL
       SELECT approval_audit_id FROM orchestration_workflow_runs WHERE approval_audit_id = ?
       LIMIT 1`,
    )
    .get(input.auditId, input.auditId, input.auditId)
  if (consumed)
    throw new OrchestrationOperationsError(
      "invalid-approval",
      "Approval audit was already consumed by another authority change.",
    )
  const row = db
    .prepare(
      `SELECT a.invocation_id, a.status, a.caller_chat_id, a.caller_run_id, a.tool_name, a.tier,
              p.decision, p.input_summary
       FROM mcp_audit_records a
       JOIN mcp_approval_requests p ON p.invocation_id = a.invocation_id
       WHERE a.id = ? AND p.id = a.invocation_id`,
    )
    .get(input.auditId) as Row | undefined
  let persistedContext: unknown = null
  try {
    persistedContext = JSON.parse(String(row?.input_summary)).contextHash
  } catch {
    persistedContext = null
  }
  const expectedContext = approvalContextHash({
    toolName: input.toolName,
    callerChatId: input.callerChatId,
    callerRunId: input.callerRunId,
    authority: input.authority,
  })
  if (
    !row ||
    row.status !== "completed" ||
    row.decision !== "approve" ||
    row.tool_name !== input.toolName ||
    Number(row.tier) !== 3 ||
    row.caller_chat_id !== input.callerChatId ||
    (row.caller_run_id ?? null) !== input.callerRunId ||
    persistedContext !== expectedContext
  ) {
    throw new OrchestrationOperationsError(
      "invalid-approval",
      "Approval audit does not match a completed Stage 3 decision for this exact authority change.",
    )
  }
}

function consumeApprovalAudit(
  db: Database.Database,
  auditId: string,
  taskId: string,
  toolName: OrchestrationAuthorityTool,
) {
  try {
    db.prepare(
      `INSERT INTO orchestration_authority_approvals
       (audit_id, task_id, tool_name, consumed_at) VALUES (?, ?, ?, ?)`,
    ).run(auditId, taskId, toolName, epoch())
  } catch (error) {
    if (error instanceof Error && /unique|primary key/i.test(error.message))
      throw new OrchestrationOperationsError(
        "invalid-approval",
        "Approval audit was already consumed by another authority change.",
      )
    throw error
  }
}

function policyRow(taskId: string, row: Row) {
  return {
    taskId,
    version: Number(row.version),
    policy: JSON.parse(String(row.policy_json)) as OrchestrationPolicy,
    changeKind: String(row.change_kind) as PolicyChangeKind,
    approvalAuditId: row.approval_audit_id === null ? null : String(row.approval_audit_id),
    createdAt: Number(row.created_at),
  }
}
function templateRow(row: Row) {
  return {
    id: String(row.id),
    name: String(row.name),
    version: Number(row.version),
    definition: orchestrationTemplateDefinitionSchema.parse(
      JSON.parse(String(row.definition_json)),
    ),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}
function messageRow(row: Row): OrchestrationMessage {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    agentId: row.agent_id === null ? null : String(row.agent_id),
    direction: row.direction as OrchestrationMessage["direction"],
    kind: row.kind as OrchestrationMessage["kind"],
    state: row.state as OrchestrationMessage["state"],
    body: row.body === null ? null : String(row.body),
    providerMessageId: row.provider_message_id === null ? null : String(row.provider_message_id),
    createdAt: Number(row.created_at),
  }
}
function parseObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value))
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}
function setNullableNumber(
  target: Record<string, unknown>,
  key: string,
  value: number | null,
): void {
  if (value === null) delete target[key]
  else target[key] = value
}
function epoch(): number {
  return Math.floor(Date.now() / 1000)
}

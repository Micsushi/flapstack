import type Database from "better-sqlite3"
import { openAppDatabase } from "./db/access"
import { createHash } from "node:crypto"
import { drizzle } from "drizzle-orm/better-sqlite3"
import {
  AI_TASK_PROPOSAL_BATCH_CAP,
  AI_TASK_PROPOSAL_PENDING_CAP,
  AI_TASK_PROPOSAL_RATE_CAP,
  AI_TASK_PROPOSAL_RATE_WINDOW_MS,
  taskProposalApprovalSchema,
  taskProposalContentSchema,
  taskProposalReviewSchema,
  type TaskProposalApproval,
  type TaskProposalContent,
  type TaskProposalPreview,
  type TaskProposalRecord,
  type TaskProposalReview,
} from "../../shared/task-proposals"
import { createRebalancedBoardOrders } from "../../shared/task-kanban"
import { parseCustomPermissionToggles, parsePermissionMode } from "./permissions"
import { appendMcpAuditRecord } from "./mcp-control/audit-storage"
import type { McpCallerIdentity } from "./mcp-control/types"
import * as schema from "./db/schema"

export type TaskProposalActor =
  { type: "user"; id: string } | ({ type: "agent" } & Pick<McpCallerIdentity, "chatId" | "runId">)

export type TaskProposalErrorCode =
  "invalid-input" | "not-found" | "out-of-scope" | "conflict" | "stale-caller" | "stale-target"

export class TaskProposalError extends Error {
  constructor(
    readonly code: TaskProposalErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "TaskProposalError"
  }
}

type Row = Record<string, unknown>
type CallerScope = {
  chatId: string
  runId: string | null
  kind: string
  projectId: string | null
  taskId: string | null
}

export type TaskProposalHooks = {
  now?: () => number
}

export class TaskProposalService {
  constructor(
    private readonly databasePath: string,
    private readonly hooks: TaskProposalHooks = {},
  ) {}

  list(
    actor: TaskProposalActor,
    input: {
      projectId?: string
      includeArchived?: boolean
      limit?: number
      cursor?: string
    } = {},
  ): { items: TaskProposalRecord[]; nextCursor: string | null } {
    return this.withDatabase((database) => {
      const scope = actorScope(database, actor)
      if (input.projectId) requireProjectVisible(scope, input.projectId)
      const start = decodeCursor(input.cursor)
      const limit = Math.max(1, Math.min(input.limit ?? 20, 100))
      const conditions = [input.includeArchived ? "1 = 1" : "tp.archived_at IS NULL"]
      const params: unknown[] = []
      if (actor.type === "agent") {
        conditions.push("tp.proposed_by_chat_id = ?")
        params.push(actor.chatId)
      }
      const projectId = input.projectId ?? scope?.projectId
      if (projectId) {
        conditions.push("tp.project_id = ?")
        params.push(projectId)
      }
      const rows = database
        .prepare(
          `${proposalSelect()} WHERE ${conditions.join(" AND ")}
           ORDER BY tp.updated_at DESC, tp.id LIMIT ? OFFSET ?`,
        )
        .all(...params, limit + 1, start) as Row[]
      return {
        items: rows.slice(0, limit).map(toRecord),
        nextCursor:
          rows.length > limit
            ? Buffer.from(String(start + limit), "utf8").toString("base64url")
            : null,
      }
    })
  }

  read(actor: TaskProposalActor, proposalId: string): TaskProposalRecord {
    return this.withDatabase((database) => {
      const scope = actorScope(database, actor)
      const record = requireRecord(database, proposalId)
      requireRecordVisible(actor, scope, record)
      return record
    })
  }

  preview(actor: TaskProposalActor, proposalId: string): TaskProposalPreview {
    return this.withDatabase((database) => {
      const scope = actorScope(database, actor)
      const proposal = requireRecord(database, proposalId)
      requireRecordVisible(actor, scope, proposal)
      if (proposal.status !== "pending") fail("conflict", "Only pending proposals can be reviewed.")
      const project = requireProject(database, proposal.projectId)
      requireProposerCurrent(database, proposal)
      return buildPreview(project, proposal)
    })
  }

  propose(
    actor: Extract<TaskProposalActor, { type: "agent" }>,
    input: { idempotencyKey: string; proposal: TaskProposalContent },
  ): { record: TaskProposalRecord; created: boolean } {
    const proposal = parseContent(input.proposal)
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey)
    return this.withDatabase((database) => {
      const transaction = database.transaction(() => {
        const scope = actorScope(database, actor)!
        requireProjectVisible(scope, proposal.projectId)
        requireProject(database, proposal.projectId)
        const proposalId = stableId(
          "task-proposal",
          actor.chatId,
          actor.runId ?? "",
          idempotencyKey,
        )
        const existing = findRecord(database, proposalId)
        if (existing) {
          requireRecordVisible(actor, scope, existing)
          if (!sameContent(existing, proposal)) {
            fail("conflict", "Idempotency key is already bound to a different task proposal.")
          }
          return { record: existing, created: false }
        }

        enforceCreationLimits(database, actor.chatId, this.now())
        const now = this.now()
        database
          .prepare(
            `INSERT INTO task_proposals (
             id, project_id, proposed_by_chat_id, name, description, target_status, status,
             version, source_type, source_path, source_candidate_id, source_fingerprint,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            proposalId,
            proposal.projectId,
            actor.chatId,
            proposal.name,
            proposal.description,
            proposal.targetStatus,
            proposal.source?.sourceType ?? null,
            proposal.source?.sourcePath ?? null,
            proposal.source?.sourceCandidateId ?? null,
            proposal.source?.sourceFingerprint ?? null,
            now,
            now,
          )
        return { record: requireRecord(database, proposalId), created: true }
      })
      return transaction.immediate()
    })
  }

  update(
    actor: Extract<TaskProposalActor, { type: "agent" }>,
    input: { proposalId: string; expectedVersion: number; proposal: TaskProposalContent },
  ): { record: TaskProposalRecord; changed: boolean } {
    const proposal = parseContent(input.proposal)
    return this.withDatabase((database) => {
      const transaction = database.transaction(() => {
        const scope = actorScope(database, actor)!
        const current = requireRecord(database, input.proposalId)
        requireRecordVisible(actor, scope, current)
        requireProjectVisible(scope, proposal.projectId)
        requireProject(database, proposal.projectId)
        if (current.status !== "pending") fail("conflict", "Terminal proposals cannot be updated.")
        if (sameContent(current, proposal)) {
          if (
            current.version !== input.expectedVersion &&
            current.version !== input.expectedVersion + 1
          ) {
            conflict(current.version)
          }
          return { record: current, changed: false }
        }
        if (current.version !== input.expectedVersion) conflict(current.version)
        const now = this.now()
        const result = database
          .prepare(
            `UPDATE task_proposals SET project_id = ?, name = ?, description = ?, target_status = ?,
             source_type = ?, source_path = ?, source_candidate_id = ?, source_fingerprint = ?,
             version = version + 1, updated_at = ?
           WHERE id = ? AND status = 'pending' AND version = ?`,
          )
          .run(
            proposal.projectId,
            proposal.name,
            proposal.description,
            proposal.targetStatus,
            proposal.source?.sourceType ?? null,
            proposal.source?.sourcePath ?? null,
            proposal.source?.sourceCandidateId ?? null,
            proposal.source?.sourceFingerprint ?? null,
            now,
            input.proposalId,
            input.expectedVersion,
          )
        if (result.changes !== 1) conflict(latestVersion(database, input.proposalId))
        return { record: requireRecord(database, input.proposalId), changed: true }
      })
      return transaction.immediate()
    })
  }

  cancel(
    actor: Extract<TaskProposalActor, { type: "agent" }>,
    input: { proposalId: string; expectedVersion: number },
  ): { record: TaskProposalRecord; changed: boolean } {
    return this.withDatabase((database) => {
      const transaction = database.transaction(() => {
        const scope = actorScope(database, actor)!
        const current = requireRecord(database, input.proposalId)
        requireRecordVisible(actor, scope, current)
        if (current.status === "cancelled") {
          if (
            current.version !== input.expectedVersion &&
            current.version !== input.expectedVersion + 1
          ) {
            conflict(current.version)
          }
          return { record: current, changed: false }
        }
        if (current.status !== "pending")
          fail("conflict", "Terminal proposals cannot be cancelled.")
        if (current.version !== input.expectedVersion) conflict(current.version)
        const now = this.now()
        const result = database
          .prepare(
            `UPDATE task_proposals SET status = 'cancelled', version = version + 1,
             decided_at = ?, archived_at = ?, updated_at = ?
           WHERE id = ? AND status = 'pending' AND version = ?`,
          )
          .run(now, now, now, input.proposalId, input.expectedVersion)
        if (result.changes !== 1) conflict(latestVersion(database, input.proposalId))
        return { record: requireRecord(database, input.proposalId), changed: true }
      })
      return transaction.immediate()
    })
  }

  approve(actor: Extract<TaskProposalActor, { type: "user" }>, input: TaskProposalApproval) {
    const result = this.approveBatch(actor, { approvals: [input] })
    return { ...result, item: result.items[0]! }
  }

  approveBatch(
    actor: Extract<TaskProposalActor, { type: "user" }>,
    input: { approvals: TaskProposalApproval[] },
  ): {
    items: Array<{
      proposal: TaskProposalRecord
      task: Row
      chat: Row
      subChat: Row
      created: boolean
    }>
    createdCount: number
  } {
    const approvals = input.approvals.map((approval) => taskProposalApprovalSchema.parse(approval))
    if (approvals.length < 1 || approvals.length > AI_TASK_PROPOSAL_BATCH_CAP) {
      fail(
        "invalid-input",
        `Approval batches must contain 1 to ${AI_TASK_PROPOSAL_BATCH_CAP} proposals.`,
      )
    }
    if (new Set(approvals.map((approval) => approval.proposalId)).size !== approvals.length) {
      fail("invalid-input", "Approval batches cannot contain duplicate proposal IDs.")
    }

    return this.withDatabase((database) => {
      const transaction = database.transaction(() => {
        const checked = approvals.map((approval) => {
          const proposal = requireRecord(database, approval.proposalId)
          const review = parseReview(approval.review)
          const project = requireProject(database, proposal.projectId)
          requireProposerCurrent(database, proposal)
          validateReview(review)
          return { approval, proposal, project, review }
        })
        const items = checked.map(({ approval, proposal, project, review }) =>
          approveOne(database, approval.expectedVersion, proposal, project, review, this.now()),
        )
        appendMcpAuditRecord(drizzle(database, { schema }), {
          invocationId: `trpc:${stableId("proposal-review", ...approvals.map((item) => item.proposalId))}`,
          status: "completed",
          caller: { chatId: actor.id },
          toolName: approvals.length === 1 ? "approve_task_proposal" : "approve_task_proposals",
          tier: 2,
          input: {
            decision: "approve",
            proposalCount: approvals.length,
            proposalIds: approvals.map((item) => item.proposalId),
          },
          result: {
            ok: true,
            data: { itemCount: items.length, taskIds: items.map((item) => item.task.id) },
          },
        })
        return items
      })
      const items = transaction.immediate()
      return { items, createdCount: items.filter((item) => item.created).length }
    })
  }

  deny(
    actor: Extract<TaskProposalActor, { type: "user" }>,
    input: { proposalId: string; expectedVersion: number },
  ): { record: TaskProposalRecord; changed: boolean } {
    return this.withDatabase((database) => {
      const transaction = database.transaction(() => {
        const current = requireRecord(database, input.proposalId)
        requireProject(database, current.projectId)
        requireProposerCurrent(database, current)
        if (current.status === "denied") {
          if (
            current.version !== input.expectedVersion &&
            current.version !== input.expectedVersion + 1
          ) {
            conflict(current.version)
          }
          return { record: current, changed: false }
        }
        if (current.status !== "pending") fail("conflict", "Terminal proposals cannot be denied.")
        if (current.version !== input.expectedVersion) conflict(current.version)
        const now = this.now()
        const result = database
          .prepare(
            `UPDATE task_proposals SET status = 'denied', version = version + 1,
               decided_at = ?, archived_at = ?, updated_at = ?
             WHERE id = ? AND status = 'pending' AND version = ?`,
          )
          .run(now, now, now, input.proposalId, input.expectedVersion)
        if (result.changes !== 1) conflict(latestVersion(database, input.proposalId))
        const record = requireRecord(database, input.proposalId)
        appendMcpAuditRecord(drizzle(database, { schema }), {
          invocationId: `trpc:${stableId("proposal-denial", input.proposalId, String(record.version))}`,
          status: "denied",
          caller: { chatId: actor.id },
          toolName: "deny_task_proposal",
          tier: 2,
          input: {
            decision: "deny",
            proposalId: input.proposalId,
            expectedVersion: input.expectedVersion,
          },
          result: { ok: true, data: { id: record.id, status: record.status } },
        })
        return { record, changed: true }
      })
      return transaction.immediate()
    })
  }

  private now(): number {
    return this.hooks.now?.() ?? Date.now()
  }

  private withDatabase<T>(operation: (database: Database.Database) => T): T {
    const database = openAppDatabase(this.databasePath)
    try {
      database.pragma("foreign_keys = ON")
      database.pragma("busy_timeout = 5000")
      return operation(database)
    } catch (error) {
      if (error instanceof TaskProposalError) throw error
      if (error instanceof Error && error.name === "ZodError") {
        fail("invalid-input", error.message)
      }
      const message = error instanceof Error ? error.message : "Task proposal operation failed."
      if (/UNIQUE constraint/i.test(message)) fail("conflict", message)
      if (/FOREIGN KEY|CHECK constraint/i.test(message)) fail("invalid-input", message)
      throw error
    } finally {
      database.close()
    }
  }
}

function approveOne(
  database: Database.Database,
  expectedVersion: number,
  proposal: TaskProposalRecord,
  project: Row,
  review: TaskProposalReview,
  now: number,
) {
  const taskId = stableId("proposal-task", proposal.id)
  const chatId = stableId("proposal-chat", proposal.id)
  const subChatId = stableId("proposal-subchat", proposal.id)
  const messageId = stableId("proposal-message", proposal.id)
  if (proposal.status === "approved") {
    if (proposal.version !== expectedVersion && proposal.version !== expectedVersion + 1) {
      conflict(proposal.version)
    }
    return approvedReplay(database, proposal, review, taskId, chatId, subChatId)
  }
  if (proposal.status !== "pending") fail("conflict", "Terminal proposals cannot be approved.")
  if (proposal.version !== expectedVersion) conflict(proposal.version)

  const statusTasks = database
    .prepare(
      `SELECT id, board_order FROM tasks
       WHERE project_id = ? AND status = ? AND archived_at IS NULL
       ORDER BY board_order, created_at, id`,
    )
    .all(proposal.projectId, review.status) as Array<{ id: string; board_order: string }>
  const orders = createRebalancedBoardOrders([...statusTasks.map((task) => task.id), taskId])
  for (const task of statusTasks) {
    const order = orders.get(task.id)
    if (order && order !== task.board_order) {
      database
        .prepare(
          `UPDATE tasks
           SET board_order = ?, version = version + 1, updated_at = ?
           WHERE id = ?`,
        )
        .run(order, now, task.id)
    }
  }

  const customPermissions =
    review.permissionMode === "custom" ? JSON.stringify(review.customPermissions) : null
  database
    .prepare(
      `INSERT INTO tasks (
         id, project_id, name, description, status, board_order, version,
         source_type, source_path, source_candidate_id, source_fingerprint,
         default_permission_mode, default_custom_permissions, vault_context_sections,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      taskId,
      proposal.projectId,
      review.taskName,
      review.taskDescription,
      review.status,
      orders.get(taskId),
      proposal.source?.sourceType ?? null,
      proposal.source?.sourcePath ?? null,
      proposal.source?.sourceCandidateId ?? null,
      proposal.source?.sourceFingerprint ?? null,
      review.permissionMode,
      customPermissions,
      project.vault_context_sections ?? null,
      now,
      now,
    )
  const worktreePath = review.worktreeMode === "project-checkout" ? project.path : null
  database
    .prepare(
      `INSERT INTO chats (
         id, name, project_id, task_id, scope, permission_mode, custom_permissions,
         mcp_exposure_enabled, worktree_path, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'task', ?, ?, 1, ?, ?, ?)`,
    )
    .run(
      chatId,
      review.taskName,
      proposal.projectId,
      taskId,
      review.permissionMode,
      customPermissions,
      worktreePath,
      now,
      now,
    )
  database
    .prepare(
      `INSERT INTO sub_chats (
         id, chat_id, name, mode, permission_mode, worktree_path, run_status,
         messages, created_at, updated_at
       ) VALUES (?, ?, ?, 'agent', ?, ?, NULL, ?, ?, ?)`,
    )
    .run(
      subChatId,
      chatId,
      review.taskName,
      review.permissionMode,
      worktreePath,
      JSON.stringify([
        { id: messageId, role: "user", parts: [{ type: "text", text: review.seedText }] },
      ]),
      now,
      now,
    )
  const changed = database
    .prepare(
      `UPDATE task_proposals SET status = 'approved', version = version + 1,
         decided_at = ?, archived_at = ?, updated_at = ?
       WHERE id = ? AND status = 'pending' AND version = ?`,
    )
    .run(now, now, now, proposal.id, expectedVersion)
  if (changed.changes !== 1) conflict(latestVersion(database, proposal.id))
  if (
    database.prepare("SELECT id FROM agent_runs WHERE chat_id = ? LIMIT 1").get(chatId) !==
    undefined
  ) {
    fail("conflict", "Task proposal approval must not launch an agent run.")
  }
  return {
    proposal: requireRecord(database, proposal.id),
    task: database.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Row,
    chat: database.prepare("SELECT * FROM chats WHERE id = ?").get(chatId) as Row,
    subChat: database.prepare("SELECT * FROM sub_chats WHERE id = ?").get(subChatId) as Row,
    created: true,
  }
}

function approvedReplay(
  database: Database.Database,
  proposal: TaskProposalRecord,
  review: TaskProposalReview,
  taskId: string,
  chatId: string,
  subChatId: string,
) {
  const task = database.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Row | undefined
  const chat = database.prepare("SELECT * FROM chats WHERE id = ?").get(chatId) as Row | undefined
  const subChat = database.prepare("SELECT * FROM sub_chats WHERE id = ?").get(subChatId) as
    Row | undefined
  const expectedWorktree =
    review.worktreeMode === "project-checkout"
      ? (database.prepare("SELECT path FROM projects WHERE id = ?").get(proposal.projectId) as Row)
          .path
      : null
  const messages =
    subChat && typeof subChat.messages === "string" ? JSON.parse(subChat.messages) : []
  const seedText = messages?.[0]?.parts?.[0]?.text
  const customPermissions =
    review.permissionMode === "custom" ? JSON.stringify(review.customPermissions) : null
  if (
    !task ||
    !chat ||
    !subChat ||
    task.project_id !== proposal.projectId ||
    task.name !== review.taskName ||
    (task.description ?? null) !== review.taskDescription ||
    task.status !== review.status ||
    (task.source_type ?? null) !== (proposal.source?.sourceType ?? null) ||
    (task.source_path ?? null) !== (proposal.source?.sourcePath ?? null) ||
    (task.source_candidate_id ?? null) !== (proposal.source?.sourceCandidateId ?? null) ||
    (task.source_fingerprint ?? null) !== (proposal.source?.sourceFingerprint ?? null) ||
    task.default_permission_mode !== review.permissionMode ||
    (task.default_custom_permissions ?? null) !== customPermissions ||
    chat.task_id !== taskId ||
    chat.name !== review.taskName ||
    chat.permission_mode !== review.permissionMode ||
    (chat.custom_permissions ?? null) !== customPermissions ||
    (chat.worktree_path ?? null) !== expectedWorktree ||
    seedText !== review.seedText
  ) {
    fail("conflict", "Approval replay does not match the exact reviewed task and chat state.")
  }
  return { proposal, task, chat, subChat, created: false }
}

function buildPreview(project: Row, proposal: TaskProposalRecord): TaskProposalPreview {
  const permissionMode = parsePermissionMode(project.default_permission_mode)
  if (!permissionMode) fail("stale-target", "Target project has invalid permission defaults.")
  let customPermissions: Record<string, unknown> | null = null
  if (permissionMode === "custom") {
    try {
      customPermissions = parseCustomPermissionToggles(
        JSON.parse(String(project.default_custom_permissions)),
      )
    } catch {
      customPermissions = null
    }
    if (!customPermissions) fail("stale-target", "Target project has invalid custom permissions.")
  }
  const context = proposal.description?.trim() || proposal.name
  return {
    proposal,
    project: { id: proposal.projectId, name: String(project.name), path: String(project.path) },
    review: {
      taskName: proposal.name,
      taskDescription: proposal.description,
      status: proposal.targetStatus,
      permissionMode,
      customPermissions,
      worktreeMode: "task-primary",
      seedText: [
        `Implement the approved AI task proposal: ${proposal.name}`,
        "",
        "Reviewed proposal context and acceptance:",
        context,
        "",
        `Proposal ID: ${proposal.id}`,
        "This chat is idle. Start an agent run only after reviewing the current repository state.",
      ].join("\n"),
    },
  }
}

function actorScope(database: Database.Database, actor: TaskProposalActor): CallerScope | null {
  if (actor.type === "user") return null
  const chat = database
    .prepare(
      `SELECT id, scope, project_id, task_id FROM chats
       WHERE id = ? AND archived_at IS NULL`,
    )
    .get(actor.chatId) as Row | undefined
  if (!chat) fail("stale-caller", "Proposal caller chat is missing or archived.")
  if (actor.runId) {
    const run = database
      .prepare(
        `SELECT id FROM agent_runs
         WHERE id = ? AND chat_id = ? AND status = 'running'`,
      )
      .get(actor.runId, actor.chatId)
    if (!run) fail("stale-caller", "Proposal caller run is missing or inactive.")
  }
  return {
    chatId: actor.chatId,
    runId: actor.runId ?? null,
    kind: String(chat.scope),
    projectId: chat.project_id ? String(chat.project_id) : null,
    taskId: chat.task_id ? String(chat.task_id) : null,
  }
}

function requireProjectVisible(scope: CallerScope | null, projectId: string): void {
  if (scope?.projectId && scope.projectId !== projectId) {
    fail("out-of-scope", "Project is outside the proposal caller scope.")
  }
  if (scope && scope.kind !== "global" && !scope.projectId) {
    fail("out-of-scope", "Caller has no project scope for task proposals.")
  }
}

function requireRecordVisible(
  actor: TaskProposalActor,
  scope: CallerScope | null,
  record: TaskProposalRecord,
): void {
  requireProjectVisible(scope, record.projectId)
  if (actor.type === "agent" && record.proposedByChatId !== actor.chatId) {
    fail("out-of-scope", "Agents can only manage proposals created by their caller chat.")
  }
}

function requireProject(database: Database.Database, projectId: string): Row {
  const project = database
    .prepare(
      `SELECT id, name, path, default_permission_mode, default_custom_permissions,
              vault_context_sections
       FROM projects WHERE id = ? AND archived_at IS NULL`,
    )
    .get(projectId) as Row | undefined
  if (!project) fail("stale-target", "Task proposal target project is missing or archived.")
  return project
}

function requireProposerCurrent(database: Database.Database, proposal: TaskProposalRecord): void {
  const caller = database
    .prepare("SELECT scope, project_id FROM chats WHERE id = ? AND archived_at IS NULL")
    .get(proposal.proposedByChatId) as Row | undefined
  if (!caller) fail("stale-caller", "Task proposal caller is missing or archived.")
  if (caller.scope !== "global" && caller.project_id !== proposal.projectId) {
    fail("stale-caller", "Task proposal caller no longer owns the target project scope.")
  }
}

function enforceCreationLimits(database: Database.Database, chatId: string, now: number): void {
  const pending = database
    .prepare(
      `SELECT count(*) count FROM task_proposals
       WHERE proposed_by_chat_id = ? AND status = 'pending' AND archived_at IS NULL`,
    )
    .get(chatId) as { count: number }
  if (pending.count >= AI_TASK_PROPOSAL_PENDING_CAP) {
    fail("conflict", `Caller already has ${AI_TASK_PROPOSAL_PENDING_CAP} pending proposals.`)
  }
  const recent = database
    .prepare(
      `SELECT count(*) count FROM task_proposals
       WHERE proposed_by_chat_id = ? AND created_at >= ?`,
    )
    .get(chatId, now - AI_TASK_PROPOSAL_RATE_WINDOW_MS) as { count: number }
  if (recent.count >= AI_TASK_PROPOSAL_RATE_CAP) {
    fail("conflict", `Caller exceeded ${AI_TASK_PROPOSAL_RATE_CAP} proposals per minute.`)
  }
}

function validateReview(review: TaskProposalReview): void {
  const customPermissions = parseCustomPermissionToggles(review.customPermissions)
  if (review.permissionMode === "custom" && !customPermissions) {
    fail("invalid-input", "Custom permission mode requires complete capability defaults.")
  }
  if (review.permissionMode !== "custom" && review.customPermissions !== null) {
    fail("invalid-input", "Custom capabilities require custom permission mode.")
  }
}

function parseContent(value: TaskProposalContent): TaskProposalContent {
  const parsed = taskProposalContentSchema.safeParse(value)
  if (!parsed.success) fail("invalid-input", parsed.error.issues[0]?.message ?? "Invalid proposal.")
  return parsed.data
}

function parseReview(value: TaskProposalReview): TaskProposalReview {
  const parsed = taskProposalReviewSchema.safeParse(value)
  if (!parsed.success) fail("invalid-input", parsed.error.issues[0]?.message ?? "Invalid review.")
  return parsed.data
}

function proposalSelect(): string {
  return `SELECT tp.*, p.name project_name
          FROM task_proposals tp JOIN projects p ON p.id = tp.project_id`
}

function findRecord(database: Database.Database, proposalId: string): TaskProposalRecord | null {
  const row = database.prepare(`${proposalSelect()} WHERE tp.id = ?`).get(proposalId) as
    Row | undefined
  return row ? toRecord(row) : null
}

function requireRecord(database: Database.Database, proposalId: string): TaskProposalRecord {
  const record = findRecord(database, proposalId)
  if (!record) fail("not-found", "Task proposal not found.")
  return record
}

function toRecord(row: Row): TaskProposalRecord {
  const source = row.source_type
    ? {
        sourceType: row.source_type as "openspec" | "markdown",
        sourcePath: String(row.source_path),
        sourceCandidateId: String(row.source_candidate_id),
        sourceFingerprint: String(row.source_fingerprint),
      }
    : null
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    projectName: String(row.project_name),
    proposedByChatId: String(row.proposed_by_chat_id),
    name: String(row.name),
    description: row.description == null ? null : String(row.description),
    targetStatus: row.target_status as "backlog" | "planned",
    status: row.status as TaskProposalRecord["status"],
    version: Number(row.version),
    source,
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
    decidedAt: row.decided_at == null ? null : Number(row.decided_at),
    archivedAt: row.archived_at == null ? null : Number(row.archived_at),
  }
}

function sameContent(record: TaskProposalRecord, content: TaskProposalContent): boolean {
  return (
    canonicalJson({
      projectId: record.projectId,
      name: record.name,
      description: record.description,
      targetStatus: record.targetStatus,
      source: record.source,
    }) === canonicalJson(content)
  )
}

function latestVersion(database: Database.Database, proposalId: string): number {
  return Number(
    (database.prepare("SELECT version FROM task_proposals WHERE id = ?").get(proposalId) as Row)
      ?.version ?? 0,
  )
}

function normalizeIdempotencyKey(value: string): string {
  const key = value.trim()
  if (!key || key.length > 128) fail("invalid-input", "Invalid idempotency key.")
  return key
}

function decodeCursor(cursor?: string): number {
  if (!cursor) return 0
  const start = Number.parseInt(Buffer.from(cursor, "base64url").toString("utf8"), 10)
  if (!Number.isSafeInteger(start) || start < 0) fail("invalid-input", "Invalid cursor.")
  return start
}

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 32)}`
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function conflict(version: number): never {
  fail("conflict", `Task proposal changed. Current version is ${version}.`)
}

function fail(code: TaskProposalErrorCode, message: string): never {
  throw new TaskProposalError(code, message)
}
